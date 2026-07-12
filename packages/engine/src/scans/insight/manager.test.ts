/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import {
  type Config,
  ConfigSchema,
  type DeepScanConfig,
  type FindingCategory,
  type NightcoreEvent,
  type SurfaceCommand,
} from '@nightcore/contracts';
import type { Logger } from '@nightcore/shared';

import type { SessionRunnerConfig } from '../../session/session-runner.js';
import {
  AnalysisManager,
  type AnalysisRunnerFactory,
} from './manager.js';

type StartAnalysis = Extract<SurfaceCommand, { type: 'start-analysis' }>;

/**
 * Drive the `AnalysisManager` orchestrator with a FAKE runner injected via the
 * `runnerFactory` dep — no SDK, no subprocess. Each fake emits scripted
 * `session-completed` / `session-failed` events through the `emit` callback it is
 * handed, exactly as the real `SessionRunner` would, so the manager's pooling,
 * retry, accumulation, cancellation, and event ordering are all exercised in
 * isolation.
 */

const BASE_CONFIG: Config = ConfigSchema.parse({
  paths: { home: '/tmp/nc-home', sessions: '/tmp/nc-home/sessions' },
});

/** A valid `start-analysis` command for the given categories. */
function startCommand(
  categories: FindingCategory[],
  over: Partial<{
    runId: string;
    maxConcurrency: number;
  }> = {},
): StartAnalysis {
  return {
    type: 'start-analysis',
    runId: over.runId ?? 'run-1',
    projectPath: '/proj',
    scope: 'repo',
    categories,
    ...(over.maxConcurrency !== undefined
      ? { maxConcurrency: over.maxConcurrency }
      : {}),
  };
}

/** A finished `analysis-completed` event awaited as a promise: resolves once the
 *  manager emits a terminal `analysis-completed` or `analysis-failed`. */
function collect(): {
  events: NightcoreEvent[];
  emit: (event: NightcoreEvent) => void;
  done: Promise<NightcoreEvent[]>;
} {
  const events: NightcoreEvent[] = [];
  let resolve!: (value: NightcoreEvent[]) => void;
  const done = new Promise<NightcoreEvent[]>((r) => {
    resolve = r;
  });
  const emit = (event: NightcoreEvent): void => {
    events.push(event);
    if (event.type === 'analysis-completed' || event.type === 'analysis-failed') {
      resolve(events);
    }
  };
  return { events, emit, done };
}

/** Emit a `session-completed` carrying `result` + usage/cost, then resolve. */
function completing(
  result: string,
  costUsd = 0,
  usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  },
): (emit: (e: NightcoreEvent) => void) => Promise<void> {
  return async (emit) => {
    emit({
      type: 'session-completed',
      sessionId: -1,
      result,
      costUsd,
      numTurns: 1,
      durationMs: 1,
      usage,
    });
  };
}

const ONE_FINDING = JSON.stringify([
  { severity: 'high', effort: 'small', title: 'Issue', description: 'desc' },
]);

describe('AnalysisManager — concurrency cap', () => {
  test('runs at most maxConcurrency category passes at once', async () => {
    const CAP = 2;
    let inFlight = 0;
    let peak = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });

    const factory: AnalysisRunnerFactory = (_cfg, emit) => ({
      async run() {
        inFlight++;
        peak = Math.max(peak, inFlight);
        // Once the pool has saturated the cap, peak is proven — open the gate so
        // every runner can drain (the later passes still pass through the same cap
        // as earlier ones complete).
        if (inFlight >= CAP) release();
        await gate;
        await completing(ONE_FINDING)(emit);
        inFlight--;
      },
      async interrupt() {},
    });

    const { emit, done } = collect();
    const manager = new AnalysisManager({
      config: BASE_CONFIG,
      apiKeyFallback: false,
      emit,
      runnerFactory: factory,
    });

    manager.start(
      startCommand(['bugs', 'security', 'refactor', 'performance'], {
        maxConcurrency: CAP,
      }),
    );
    await done;
    expect(peak).toBe(CAP);
  });

  test('defaults to 6-way concurrency when no maxConcurrency override is given', async () => {
    // With 8 categories and no override the pool saturates at the default of 6
    // (runPool caps at categories.length, here 8). The gate releases
    // only once 6 are in flight, so this hangs/fails if the default regresses below 6.
    let inFlight = 0;
    let peak = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });

    const factory: AnalysisRunnerFactory = (_cfg, emit) => ({
      async run() {
        inFlight++;
        peak = Math.max(peak, inFlight);
        if (peak >= 6) release();
        await gate;
        await completing(ONE_FINDING)(emit);
        inFlight--;
      },
      async interrupt() {},
    });

    const { emit, done } = collect();
    const manager = new AnalysisManager({
      config: BASE_CONFIG,
      apiKeyFallback: false,
      emit,
      runnerFactory: factory,
    });

    manager.start(
      startCommand([
        'architecture',
        'bugs',
        'refactor',
        'performance',
        'security',
        'tests',
        'docs',
        'ui-ux',
      ]),
    );
    await done;
    expect(peak).toBe(6);
  });
});

describe('AnalysisManager — cancellation', () => {
  test('cancel interrupts live runners and surfaces reason "aborted"', async () => {
    const live: Array<{ resolve: () => void; emit: (e: NightcoreEvent) => void }> =
      [];

    const factory: AnalysisRunnerFactory = (_cfg, emit) => {
      let abort!: () => void;
      const parked = new Promise<void>((r) => {
        abort = r;
      });
      return {
        async run() {
          // Park until interrupted; then emit an aborted failure like the real
          // runner would when its query is interrupted.
          live.push({ resolve: abort, emit });
          await parked;
          emit({
            type: 'session-failed',
            sessionId: -1,
            reason: 'aborted',
            message: 'interrupted',
          });
        },
        async interrupt() {
          abort();
        },
      };
    };

    const { emit, done } = collect();
    const manager = new AnalysisManager({
      config: BASE_CONFIG,
      apiKeyFallback: false,
      emit,
      runnerFactory: factory,
    });

    manager.start(startCommand(['bugs', 'security']));
    // Let the pool spin up its runners, then cancel.
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 5));
    expect(live.length).toBeGreaterThan(0);
    manager.cancel('run-1');

    const events = await done;
    const failed = events.find((e) => e.type === 'analysis-failed');
    expect(failed).toBeDefined();
    expect(failed?.type === 'analysis-failed' && failed.reason).toBe('aborted');
  });
});

describe('AnalysisManager — failed-session observability', () => {
  test('logs a WARN with the category, reason, and message when a session fails', async () => {
    // Reproduces the "every category completed — 0 findings, $0.00" case (e.g. an
    // API rate-limit rejecting each session before any billable work): a failed
    // session still flows through `emitItemCompleted` as a completed-with-0 item,
    // so the run looks benign in the logs unless the captured reason is surfaced.
    const factory: AnalysisRunnerFactory = (_cfg, emit) => ({
      async run() {
        emit({
          type: 'session-failed',
          sessionId: -1,
          reason: 'rate-limit',
          message: 'overloaded',
        });
      },
      async interrupt() {},
    });

    const warns: Array<{ msg: string; meta?: unknown }> = [];
    const logger: Logger = {
      error() {},
      warn(msg, meta) {
        warns.push({ msg, meta });
      },
      info() {},
      debug() {},
      child() {
        return logger;
      },
    };

    const { emit, done } = collect();
    const manager = new AnalysisManager({
      config: BASE_CONFIG,
      apiKeyFallback: false,
      emit,
      logger,
      runnerFactory: factory,
    });

    manager.start(startCommand(['bugs']));
    await done;

    const hit = warns.find(
      (w) => (w.meta as { reason?: string }).reason === 'rate-limit',
    );
    expect(hit).toBeDefined();
    expect((hit?.meta as { item?: string }).item).toBe('bugs');
    expect((hit?.meta as { message?: string }).message).toBe('overloaded');
  });
});

describe('AnalysisManager — corrective retry', () => {
  test('a non-JSON-then-JSON pass triggers exactly ONE corrective retry', async () => {
    let calls = 0;
    const prompts: string[] = [];

    const factory: AnalysisRunnerFactory = (
      cfg: SessionRunnerConfig,
      emit,
    ) => ({
      async run() {
        calls++;
        prompts.push(cfg.prompt);
        // First call: prose (no JSON). Retry call: valid JSON.
        const isRetry = cfg.prompt.includes('was not valid JSON');
        await completing(isRetry ? ONE_FINDING : 'sorry, here is some prose')(
          emit,
        );
      },
      async interrupt() {},
    });

    const { emit, done } = collect();
    const manager = new AnalysisManager({
      config: BASE_CONFIG,
      apiKeyFallback: false,
      emit,
      runnerFactory: factory,
    });

    manager.start(startCommand(['bugs']));
    const events = await done;

    // Exactly one original + one retry = two runner runs for the single category.
    expect(calls).toBe(2);
    expect(prompts.filter((p) => p.includes('was not valid JSON'))).toHaveLength(
      1,
    );

    const completed = events.find((e) => e.type === 'analysis-completed');
    expect(completed?.type === 'analysis-completed' && completed.findings).toHaveLength(
      1,
    );
  });
});

describe('AnalysisManager — usage/cost accumulation', () => {
  test('sums usage and cost across categories', async () => {
    const factory: AnalysisRunnerFactory = (_cfg, emit) => ({
      async run() {
        await completing(ONE_FINDING, 0.25, {
          inputTokens: 100,
          outputTokens: 20,
          reasoningOutputTokens: 0,
          cacheReadTokens: 5,
          cacheCreationTokens: 1,
        })(emit);
      },
      async interrupt() {},
    });

    const { emit, done } = collect();
    const manager = new AnalysisManager({
      config: BASE_CONFIG,
      apiKeyFallback: false,
      emit,
      runnerFactory: factory,
    });

    manager.start(startCommand(['bugs', 'security', 'refactor']));
    const events = await done;
    const completed = events.find((e) => e.type === 'analysis-completed');
    if (completed?.type !== 'analysis-completed') throw new Error('no completed');

    expect(completed.costUsd).toBeCloseTo(0.75, 6); // 3 × 0.25
    expect(completed.usage).toEqual({
      inputTokens: 300,
      outputTokens: 60,
      reasoningOutputTokens: 0,
      cacheReadTokens: 15,
      cacheCreationTokens: 3,
    });
  });
});

describe('AnalysisManager — duplicate start', () => {
  test('a duplicate-runId start() is ignored', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const factory: AnalysisRunnerFactory = (_cfg, emit) => ({
      async run() {
        await gate;
        await completing(ONE_FINDING)(emit);
      },
      async interrupt() {},
    });

    const { events, emit, done } = collect();
    const manager = new AnalysisManager({
      config: BASE_CONFIG,
      apiKeyFallback: false,
      emit,
      runnerFactory: factory,
    });

    manager.start(startCommand(['bugs'], { runId: 'dup' }));
    // Second start with the SAME runId while the first is still active: ignored.
    manager.start(startCommand(['security'], { runId: 'dup' }));
    release();
    await done;

    const starts = events.filter((e) => e.type === 'analysis-started');
    expect(starts).toHaveLength(1);
    // The second command's category ('security') never ran.
    const catStarts = events.filter(
      (e) => e.type === 'analysis-category-started',
    );
    expect(catStarts).toHaveLength(1);
    expect(
      catStarts[0]?.type === 'analysis-category-started' &&
        catStarts[0].category,
    ).toBe('bugs');
  });
});

describe('AnalysisManager — event ordering', () => {
  test('emits analysis-started → category-* → analysis-completed in order', async () => {
    const factory: AnalysisRunnerFactory = (_cfg, emit) => ({
      async run() {
        await completing(ONE_FINDING)(emit);
      },
      async interrupt() {},
    });

    const { emit, done } = collect();
    const manager = new AnalysisManager({
      config: BASE_CONFIG,
      apiKeyFallback: false,
      emit,
      runnerFactory: factory,
    });

    manager.start(startCommand(['bugs']));
    const events = await done;
    const types = events.map((e) => e.type);

    expect(types[0]).toBe('analysis-started');
    expect(types[types.length - 1]).toBe('analysis-completed');
    // A category's started precedes its completed.
    const startedAt = types.indexOf('analysis-category-started');
    const completedAt = types.indexOf('analysis-category-completed');
    expect(startedAt).toBeGreaterThan(0);
    expect(completedAt).toBeGreaterThan(startedAt);
    expect(completedAt).toBeLessThan(types.length - 1);
  });
});

// ─── Deep mode (issue #294): the multi-round convergence loop ────────────────────

/** A deep `start-analysis` command (opts into the round loop). */
function deepCommand(
  categories: FindingCategory[],
  deep: Partial<DeepScanConfig> = {},
): StartAnalysis {
  return {
    ...startCommand(categories),
    deep: {
      maxRoundsPerCategory: 15,
      convergenceEmptyRounds: 2,
      maxFindingsPerRound: 20,
      ...deep,
    },
  };
}

/** A fileless finding with the given title — kept by grounding (no file to verify)
 *  and fingerprinted by title, so repeating a title reads as zero net-new. */
function findingJson(title: string): string {
  return JSON.stringify([
    { severity: 'high', effort: 'small', title, description: 'd' },
  ]);
}

describe('AnalysisManager — deep mode: convergence', () => {
  test('stops after K consecutive zero-net-new rounds', async () => {
    let rounds = 0;
    const factory: AnalysisRunnerFactory = (_cfg, emit) => ({
      async run() {
        rounds++;
        // Always the SAME finding: round 1 is 1 net-new, every later round is 0.
        await completing(findingJson('Issue A'))(emit);
      },
      async interrupt() {},
    });

    const { events, emit, done } = collect();
    const manager = new AnalysisManager({
      config: BASE_CONFIG,
      apiKeyFallback: false,
      emit,
      runnerFactory: factory,
    });

    manager.start(
      deepCommand(['bugs'], {
        convergenceEmptyRounds: 2,
        maxRoundsPerCategory: 15,
      }),
    );
    await done;

    // r1: 1 new (streak 0) · r2: 0 new (streak 1) · r3: 0 new (streak 2 = K) → stop.
    expect(rounds).toBe(3);
    const roundEvents = events.filter(
      (e) => e.type === 'analysis-category-round-completed',
    );
    expect(roundEvents).toHaveLength(3);
    const newCounts = roundEvents.map((e) =>
      e.type === 'analysis-category-round-completed'
        ? e.newFindingsThisRound
        : -1,
    );
    expect(newCounts).toEqual([1, 0, 0]);
    // 1-based round indices in order.
    expect(
      roundEvents.map((e) =>
        e.type === 'analysis-category-round-completed' ? e.round : -1,
      ),
    ).toEqual([1, 2, 3]);
  });
});

describe('AnalysisManager — deep mode: non-convergence backstop', () => {
  test('maxRoundsPerCategory caps a never-converging category', async () => {
    let rounds = 0;
    const factory: AnalysisRunnerFactory = (_cfg, emit) => ({
      async run() {
        rounds++;
        // A UNIQUE finding every round → 1 net-new each → never converges.
        await completing(findingJson(`Issue ${rounds}`))(emit);
      },
      async interrupt() {},
    });

    const { events, emit, done } = collect();
    const manager = new AnalysisManager({
      config: BASE_CONFIG,
      apiKeyFallback: false,
      emit,
      runnerFactory: factory,
    });

    manager.start(
      deepCommand(['bugs'], {
        convergenceEmptyRounds: 2,
        maxRoundsPerCategory: 4,
      }),
    );
    await done;

    // Every round adds 1 net-new (streak never reaches K), so only the backstop stops it.
    expect(rounds).toBe(4);
    expect(
      events.filter((e) => e.type === 'analysis-category-round-completed'),
    ).toHaveLength(4);
  });
});

describe('AnalysisManager — deep mode: exclusion prompt + per-round cap', () => {
  test('round 1 has no exclusion list; round ≥ 2 excludes prior findings and asks for NEW; per-round cap honored', async () => {
    const prompts: string[] = [];
    let rounds = 0;
    const factory: AnalysisRunnerFactory = (
      cfg: SessionRunnerConfig,
      emit,
    ) => ({
      async run() {
        rounds++;
        prompts.push(cfg.prompt);
        await completing(findingJson(`Issue ${rounds}`))(emit);
      },
      async interrupt() {},
    });

    const { emit, done } = collect();
    const manager = new AnalysisManager({
      config: BASE_CONFIG,
      apiKeyFallback: false,
      emit,
      runnerFactory: factory,
    });

    manager.start(
      deepCommand(['bugs'], {
        convergenceEmptyRounds: 2,
        maxRoundsPerCategory: 3,
        maxFindingsPerRound: 20,
      }),
    );
    await done;

    expect(prompts.length).toBeGreaterThanOrEqual(2);
    // Round 1: no exclusion list, classic cap wording at the deep per-round cap (20).
    expect(prompts[0]).not.toContain('ALREADY FOUND');
    expect(prompts[0]).toContain('Return AT MOST 20 findings');
    // Round 2: the exclusion list (with round-1's title) + the NEW-findings contract.
    expect(prompts[1]).toContain('ALREADY FOUND');
    expect(prompts[1]).toContain('Issue 1');
    expect(prompts[1]).toContain('Return AT MOST 20 **NEW** findings');
  });
});

describe('AnalysisManager — deep OFF path is unchanged', () => {
  test('a non-deep command runs exactly one session and emits the classic per-category event (no round events)', async () => {
    let calls = 0;
    const factory: AnalysisRunnerFactory = (_cfg, emit) => ({
      async run() {
        calls++;
        await completing(ONE_FINDING)(emit);
      },
      async interrupt() {},
    });

    const { events, emit, done } = collect();
    const manager = new AnalysisManager({
      config: BASE_CONFIG,
      apiKeyFallback: false,
      emit,
      runnerFactory: factory,
    });

    manager.start(startCommand(['bugs']));
    await done;

    // Exactly one session (valid JSON ⇒ no corrective retry) — byte-identical to pre-deep.
    expect(calls).toBe(1);
    // The classic per-category event still fires; NO round events in classic mode.
    expect(
      events.filter((e) => e.type === 'analysis-category-completed'),
    ).toHaveLength(1);
    expect(
      events.filter((e) => e.type === 'analysis-category-round-completed'),
    ).toHaveLength(0);
  });
});
