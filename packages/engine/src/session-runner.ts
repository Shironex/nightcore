import type {
  NightcoreEvent,
  PermissionMode,
  PermissionPolicy,
} from '@nightcore/contracts';
import type { Logger } from '@nightcore/shared';
import {
  query,
  translateMessage,
  type Options,
  type Query,
  type SDKUserMessage,
} from './sdk-adapter.js';
import { PermissionLayer, type ApprovalDecision } from './permission-layer.js';
import { ToolRegistry } from './tool-registry.js';
import { HookBus } from './hook-bus.js';

export interface SessionRunnerConfig {
  sessionId: number;
  prompt: string;
  model: string;
  permissionMode: PermissionMode;
  permissionPolicy: PermissionPolicy;
  cwd: string;
  /** When true, an `ANTHROPIC_API_KEY` is present and used as a fallback. Auth
   *  otherwise flows entirely through the local Claude CLI credentials — the
   *  runner passes NO apiKey itself (see README auth section). */
  apiKeyFallback: boolean;
}

/**
 * Owns a single SDK `query()` loop and translates each `SDKMessage` into a
 * `NightcoreEvent`. Control methods (`interrupt`, `setModel`,
 * `setPermissionMode`, `streamInput`) proxy to the SDK `Query`.
 *
 * Uses streaming input mode (prompt is an `AsyncIterable<SDKUserMessage>`) so
 * the SDK's control requests are available — `interrupt()` / `setModel()` etc.
 * are only supported in streaming mode.
 */
export class SessionRunner {
  private query?: Query;
  private readonly abort = new AbortController();
  private readonly permissions: PermissionLayer;
  private readonly registry = new ToolRegistry();
  private readonly hooks: HookBus;

  /** Streaming input plumbing: a queue of user messages + a waiter the input
   *  generator parks on between messages. */
  private readonly inputQueue: SDKUserMessage[] = [];
  private inputWaiter?: () => void;
  private inputClosed = false;

  constructor(
    private readonly cfg: SessionRunnerConfig,
    private readonly emit: (event: NightcoreEvent) => void,
    private readonly logger?: Logger,
  ) {
    this.hooks = new HookBus(logger);
    this.permissions = new PermissionLayer(
      cfg.permissionPolicy,
      (req) =>
        this.emit({
          type: 'permission-required',
          sessionId: cfg.sessionId,
          requestId: req.requestId,
          toolName: req.toolName,
          input: req.input,
          title: req.title,
        }),
      logger,
    );
  }

  /** Drive the query loop to completion. Resolves when the session reaches a
   *  terminal state; never rejects — failures surface as `session-failed`
   *  events and a returned status (degrade, don't throw). */
  async run(): Promise<void> {
    this.enqueueInput(this.cfg.prompt);

    const options: Options = {
      cwd: this.cfg.cwd,
      model: this.cfg.model,
      permissionMode: this.cfg.permissionMode,
      executable: 'bun',
      includePartialMessages: true,
      canUseTool: this.permissions.canUseTool,
      mcpServers: this.registry.mcpServers(),
      hooks: this.hooks.hooks(),
      abortController: this.abort,
      // Auth: never pass an apiKey. The SDK's bundled CLI resolves the user's
      // local Claude credentials (~/.claude); ANTHROPIC_API_KEY in the inherited
      // env is honored as a fallback automatically. See README.
      stderr: (data) => this.logger?.debug('[sdk stderr]', data),
    };

    try {
      this.query = query({ prompt: this.inputStream(), options });
      for await (const message of this.query) {
        const { events, terminal } = translateMessage(
          this.cfg.sessionId,
          message,
        );
        for (const event of events) this.emit(event);
        if (terminal) {
          this.closeInput();
          return;
        }
      }
    } catch (error) {
      this.handleCrash(error);
    } finally {
      this.permissions.failAllPending();
    }
  }

  /** Stream additional user input into a running session. */
  streamInput(text: string): void {
    this.enqueueInput(text);
  }

  async interrupt(): Promise<void> {
    this.abort.abort();
    await this.query?.interrupt().catch((error) => {
      this.logger?.debug('interrupt() rejected (likely already stopping)', error);
    });
  }

  async setModel(model: string): Promise<void> {
    await this.query?.setModel(model);
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    await this.query?.setPermissionMode(mode);
  }

  /** Resolve a parked interactive permission from a surface command. */
  approvePermission(requestId: string, decision: ApprovalDecision): boolean {
    return this.permissions.resolve(requestId, decision);
  }

  // --- streaming input internals ---------------------------------------------

  private enqueueInput(text: string): void {
    if (this.inputClosed) return;
    this.inputQueue.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: '',
    });
    this.inputWaiter?.();
    this.inputWaiter = undefined;
  }

  private closeInput(): void {
    this.inputClosed = true;
    this.inputWaiter?.();
    this.inputWaiter = undefined;
  }

  private async *inputStream(): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      while (this.inputQueue.length > 0) {
        yield this.inputQueue.shift() as SDKUserMessage;
      }
      if (this.inputClosed) return;
      await new Promise<void>((resolve) => {
        this.inputWaiter = resolve;
      });
    }
  }

  private handleCrash(error: unknown): void {
    const aborted = this.abort.signal.aborted;
    const message = error instanceof Error ? error.message : String(error);
    this.logger?.warn('session runner crashed', error);
    this.emit({
      type: 'session-failed',
      sessionId: this.cfg.sessionId,
      reason: aborted ? 'aborted' : 'runner-crash',
      message,
    });
    this.closeInput();
  }
}
