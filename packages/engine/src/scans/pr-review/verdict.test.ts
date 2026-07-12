/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import {
  type Config,
  ConfigSchema,
  type NightcoreEvent,
  type ReviewFinding,
  type SurfaceCommand,
} from '@nightcore/contracts';

import type { SessionRunnerConfig } from '../../session/session-runner.js';
import type { PrReviewRunnerFactory } from './manager.js';
import { synthesizePrVerdict } from './verdict.js';

type StartPrReview = Extract<SurfaceCommand, { type: 'start-pr-review' }>;

const BASE_CONFIG: Config = ConfigSchema.parse({
  paths: { home: '/tmp/nc-home', sessions: '/tmp/nc-home/sessions' },
});

const COMMAND: StartPrReview = {
  type: 'start-pr-review',
  runId: 'run-1',
  projectPath: '/proj',
  prNumber: 7,
  diff: 'diff --git a/src/a.ts b/src/a.ts\n+ unsafe();',
  changedFiles: ['src/a.ts'],
  lenses: ['security'],
};

function finding(over: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: 'security-fp1',
    lens: 'security',
    severity: 'high',
    file: 'src/a.ts',
    title: 'Injection',
    body: 'unsafe call',
    fingerprint: 'fp1',
    ...over,
  };
}

/** Emit a `session-completed` carrying `result` (and optionally the SDK's native
 *  `structuredOutput`), then resolve. */
function completing(
  result: string,
  costUsd = 0,
  structuredOutput?: Record<string, unknown>,
): (emit: (e: NightcoreEvent) => void) => Promise<void> {
  return async (emit) => {
    emit({
      type: 'session-completed',
      sessionId: -1,
      result,
      costUsd,
      numTurns: 1,
      durationMs: 1,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      ...(structuredOutput !== undefined ? { structuredOutput } : {}),
    });
  };
}

function deps(runnerFactory: PrReviewRunnerFactory) {
  return {
    lensesRun: COMMAND.lenses,
    changedFiles: COMMAND.changedFiles,
    command: COMMAND,
    config: BASE_CONFIG,
    apiKeyFallback: false,
    runnerFactory,
  };
}

describe('synthesizePrVerdict — structured output', () => {
  test('PREFERS the SDK structured_output over the result text', async () => {
    const factory: PrReviewRunnerFactory = (_cfg, emit) => ({
      async run() {
        // Text says one thing; the validated structured output is authoritative.
        await completing('the diff looks blocked to me', 0, {
          verdict: 'needs_revision',
          reasoning: 'from structured output',
        })(emit);
      },
      async interrupt() {},
    });
    const result = await synthesizePrVerdict({
      ...deps(factory),
      findings: [finding()],
    });
    expect(result.verdict).toBe('needs_revision');
    expect(result.reasoning).toBe('from structured output');
  });

  test('DEGRADES to text parsing when structured output is absent', async () => {
    const factory: PrReviewRunnerFactory = (_cfg, emit) => ({
      async run() {
        // No structuredOutput → fall back to prose-parsing the result text.
        await completing(
          JSON.stringify({ verdict: 'ready', reasoning: 'from text' }),
        )(emit);
      },
      async interrupt() {},
    });
    const result = await synthesizePrVerdict({
      ...deps(factory),
      findings: [],
    });
    expect(result.verdict).toBe('ready');
    expect(result.reasoning).toBe('from text');
  });
});

describe('synthesizePrVerdict — happy path', () => {
  test('returns the verdict + reasoning from a clean JSON object', async () => {
    const factory: PrReviewRunnerFactory = (_cfg, emit) => ({
      async run() {
        await completing(
          JSON.stringify({ verdict: 'blocked', reasoning: 'auth bypass' }),
        )(emit);
      },
      async interrupt() {},
    });
    const result = await synthesizePrVerdict({
      ...deps(factory),
      findings: [finding()],
    });
    expect(result.verdict).toBe('blocked');
    expect(result.reasoning).toBe('auth bypass');
    expect(result.error).toBeUndefined();
  });

  test('accepts a verdict-only object (no reasoning) wrapped in prose/fences', async () => {
    const factory: PrReviewRunnerFactory = (_cfg, emit) => ({
      async run() {
        await completing(
          'Here is my call:\n```json\n{ "verdict": "ready" }\n```',
        )(emit);
      },
      async interrupt() {},
    });
    const result = await synthesizePrVerdict({
      ...deps(factory),
      findings: [finding()],
    });
    expect(result.verdict).toBe('ready');
    expect(result.reasoning).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  test('adjudicates even a zero-finding review (a clean PR still gets a verdict)', async () => {
    let spun = false;
    const factory: PrReviewRunnerFactory = (_cfg, emit) => {
      spun = true;
      return {
        async run() {
          await completing(JSON.stringify({ verdict: 'ready' }))(emit);
        },
        async interrupt() {},
      };
    };
    const result = await synthesizePrVerdict({ ...deps(factory), findings: [] });
    expect(spun).toBe(true);
    expect(result.verdict).toBe('ready');
  });
});

describe('synthesizePrVerdict — fail-open', () => {
  test('an out-of-set verdict value yields NO verdict (after the one retry)', async () => {
    const factory: PrReviewRunnerFactory = (_cfg, emit) => ({
      async run() {
        await completing(JSON.stringify({ verdict: 'lgtm', reasoning: 'x' }))(emit);
      },
      async interrupt() {},
    });
    const result = await synthesizePrVerdict({
      ...deps(factory),
      findings: [finding()],
    });
    expect(result.verdict).toBeUndefined();
    expect(result.error).toBeDefined();
  });

  test('a runner that THROWS completes without a verdict', async () => {
    const factory: PrReviewRunnerFactory = () => ({
      async run() {
        throw new Error('verdict exploded');
      },
      async interrupt() {},
    });
    const result = await synthesizePrVerdict({
      ...deps(factory),
      findings: [finding()],
    });
    expect(result.verdict).toBeUndefined();
    expect(result.error).toContain('exploded');
  });

  test('a non-JSON answer (after the one retry) yields NO verdict', async () => {
    const factory: PrReviewRunnerFactory = (_cfg, emit) => ({
      async run() {
        await completing('I think it is probably fine, honestly')(emit);
      },
      async interrupt() {},
    });
    const result = await synthesizePrVerdict({
      ...deps(factory),
      findings: [finding()],
    });
    expect(result.verdict).toBeUndefined();
    expect(result.error).toBeDefined();
  });

  test('a session failure (no result) yields NO verdict', async () => {
    const factory: PrReviewRunnerFactory = (_cfg, emit) => ({
      async run() {
        emit({
          type: 'session-failed',
          sessionId: -1,
          reason: 'runner-crash',
          message: 'boom',
        });
      },
      async interrupt() {},
    });
    const result = await synthesizePrVerdict({
      ...deps(factory),
      findings: [finding()],
    });
    expect(result.verdict).toBeUndefined();
    expect(result.error).toBeDefined();
  });

  test('cancelled before starting yields NO verdict and error "cancelled"', async () => {
    let spun = false;
    const factory: PrReviewRunnerFactory = () => {
      spun = true;
      return { async run() {}, async interrupt() {} };
    };
    const result = await synthesizePrVerdict({
      ...deps(factory),
      findings: [finding()],
      isCancelled: () => true,
    });
    expect(spun).toBe(false);
    expect(result.verdict).toBeUndefined();
    expect(result.error).toBe('cancelled');
  });
});

describe('synthesizePrVerdict — corrective retry', () => {
  test('retries exactly ONCE on unparseable-then-valid', async () => {
    let calls = 0;
    const factory: PrReviewRunnerFactory = (cfg: SessionRunnerConfig, emit) => ({
      async run() {
        calls++;
        const isRetry = cfg.prompt.includes('was not valid JSON');
        await completing(
          isRetry ? JSON.stringify({ verdict: 'merge_with_changes' }) : 'not json',
        )(emit);
      },
      async interrupt() {},
    });
    const result = await synthesizePrVerdict({
      ...deps(factory),
      findings: [finding()],
    });
    expect(calls).toBe(2);
    expect(result.verdict).toBe('merge_with_changes');
    expect(result.error).toBeUndefined();
  });
});
