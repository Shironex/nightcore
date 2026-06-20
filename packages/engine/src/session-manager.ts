import { EventEmitter } from 'node:events';
import type {
  Config,
  NightcoreEvent,
  SessionRecord,
  SessionStatus,
  SurfaceCommand,
} from '@nightcore/contracts';
import { SessionStore } from '@nightcore/storage';
import { createMonotonicCounter, type Logger } from '@nightcore/shared';
import { SessionRunner } from './session-runner.js';

interface ManagedSession {
  id: number;
  runner: SessionRunner;
  record: SessionRecord;
}

/**
 * The supervisor. Owns a map of `sessionId → SessionRunner`, hands out monotonic
 * ids that never reset (so a late event from a torn-down runner is dropped), and
 * degrades-not-throws on crash — a runner failure surfaces as a `session-failed`
 * event, never a rejected promise.
 *
 * Generalized from shiranami's `analysis-host.ts`: same id discipline and
 * graceful-degradation semantics, but N concurrent sessions and a rich typed
 * event stream instead of a single `{ id, result }` reply.
 *
 * SPIKE: runners are in-process for now (the SDK already spawns its own CLI
 * subprocess, so an extra worker_thread per session is likely redundant
 * double-subprocessing). Whether sessions need a real OS-level worker boundary
 * for crash isolation is a deferred week-1 decision — see docs/architecture.md.
 */
export class SessionManager {
  private readonly emitter = new EventEmitter();
  private readonly nextSessionId = createMonotonicCounter();
  private readonly sessions = new Map<number, ManagedSession>();
  private readonly store: SessionStore;
  private readonly apiKeyFallback: boolean;

  constructor(
    private readonly config: Config,
    private readonly logger?: Logger,
  ) {
    this.store = new SessionStore(config.paths.sessions, logger);
    this.apiKeyFallback = Boolean(process.env.ANTHROPIC_API_KEY);
  }

  /** Subscribe to the typed engine event stream. Returns an unsubscribe fn. */
  on(listener: (event: NightcoreEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  /** Dispatch a surface command. Start commands spawn a runner; the rest target
   *  an existing session by id (unknown ids are ignored — they may name a
   *  session that already tore down). */
  async dispatch(command: SurfaceCommand): Promise<void> {
    if (command.type === 'start-session') {
      this.startSession(command);
      return;
    }

    const session = this.sessions.get(command.sessionId);
    if (!session) {
      this.logger?.debug('command for unknown session dropped', {
        type: command.type,
        sessionId: command.sessionId,
      });
      return;
    }

    switch (command.type) {
      case 'send-input':
        session.runner.streamInput(command.text);
        break;
      case 'interrupt':
        await session.runner.interrupt();
        this.setStatus(session, 'interrupted');
        break;
      case 'set-model':
        await session.runner.setModel(command.model);
        break;
      case 'set-permission-mode':
        await session.runner.setPermissionMode(command.mode);
        break;
      case 'approve-permission':
        session.runner.approvePermission(command.requestId, command.decision);
        break;
    }
  }

  /** Number of currently-live sessions. */
  get activeCount(): number {
    return this.sessions.size;
  }

  private startSession(
    command: Extract<SurfaceCommand, { type: 'start-session' }>,
  ): number {
    const id = this.nextSessionId();
    const model = command.model ?? this.config.model;
    const permissionMode =
      command.permissionMode ?? this.config.permissions.mode;
    const cwd = command.cwd ?? process.cwd();

    const record: SessionRecord = {
      id,
      prompt: command.prompt,
      model,
      permissionMode,
      cwd,
      status: 'starting',
      createdAt: Date.now(),
    };

    const runner = new SessionRunner(
      {
        sessionId: id,
        prompt: command.prompt,
        model,
        permissionMode,
        permissionPolicy: this.config.permissions,
        cwd,
        apiKeyFallback: this.apiKeyFallback,
      },
      (event) => this.handleEvent(id, event),
      this.logger?.child(`session-${id}`),
    );

    const session: ManagedSession = { id, runner, record };
    this.sessions.set(id, session);
    this.store.save(record);

    this.emit({
      type: 'session-started',
      sessionId: id,
      prompt: command.prompt,
      model,
      permissionMode,
    });
    this.setStatus(session, 'running');

    // Fire-and-forget: run() never rejects (it converts crashes to events), so a
    // floating promise here is safe and keeps dispatch() non-blocking.
    void runner.run().finally(() => this.retire(id));

    return id;
  }

  /** Intercept a runner event to update bookkeeping, then forward it. A late
   *  event whose session id is no longer live is dropped (monotonic-id guard). */
  private handleEvent(id: number, event: NightcoreEvent): void {
    const session = this.sessions.get(id);
    if (!session) {
      this.logger?.debug('dropping event from retired session', { id });
      return;
    }

    switch (event.type) {
      case 'session-ready':
        session.record.sdkSessionId = event.sdkSessionId;
        break;
      case 'permission-required':
        session.record.status = 'awaiting-permission';
        break;
      case 'session-completed':
        session.record.endedAt = Date.now();
        session.record.costUsd = event.costUsd;
        session.record.status = 'completed';
        this.store.save(session.record);
        break;
      case 'session-failed':
        session.record.endedAt = Date.now();
        session.record.status = 'failed';
        this.store.save(session.record);
        break;
    }

    this.emit(event);
  }

  private setStatus(session: ManagedSession, status: SessionStatus): void {
    session.record.status = status;
    this.emit({ type: 'session-status', sessionId: session.id, status });
  }

  private retire(id: number): void {
    this.sessions.delete(id);
  }

  private emit(event: NightcoreEvent): void {
    this.emitter.emit('event', event);
  }
}
