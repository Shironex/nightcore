/// <reference types="bun" />
/**
 * The OBJECTIVE GATE seam + gauntlet adapter (issue #365, P2 FOUNDATION, safety #6).
 *
 * The gate is exec-agnostic: these tests drive it with a deterministic in-memory
 * gauntlet result, never a live spawn — the same way the Conductor's override tests do.
 * The adapter's ONLY job is mapping a Structure-Lock gauntlet result to a verdict, so a
 * production gate can reuse the existing `runChecks` machinery instead of inventing an
 * exec sink.
 */
import { describe, expect, test } from 'bun:test';

import {
  type GauntletLikeResult,
  gauntletObjectiveGate,
  type ObjectiveGateContext,
} from './objective-gate.js';

function context(): ObjectiveGateContext {
  return {
    councilRunId: 'run-gate',
    objective: 'fix the failing test',
    successCriterion: 'the repro goes green',
    positions: [{ seatId: 'a', role: 'proposer', content: 'patch X' }],
    signal: new AbortController().signal,
  };
}

describe('gauntletObjectiveGate — maps a gauntlet result to a verdict', () => {
  test('an all-green gauntlet produces a PASSED verdict with per-check breakdown', async () => {
    const result: GauntletLikeResult = {
      passed: true,
      checks: [
        { name: 'test', status: 'passed' },
        { name: 'build', status: 'passed' },
      ],
    };
    const gate = gauntletObjectiveGate(() => result);

    const verdict = await gate.evaluate(context());

    expect(verdict.passed).toBe(true);
    expect(verdict.summary).toContain('passed');
    expect(verdict.checks?.map((c) => c.passed)).toEqual([true, true]);
  });

  test('a failing gauntlet produces a FAILED verdict naming the failed check + detail', async () => {
    const result: GauntletLikeResult = {
      passed: false,
      failedCheck: 'test',
      checks: [
        { name: 'test', status: 'failed', output: '2 tests still red' },
        { name: 'build', status: 'passed' },
      ],
    };
    const gate = gauntletObjectiveGate(() => result);

    const verdict = await gate.evaluate(context());

    expect(verdict.passed).toBe(false);
    expect(verdict.summary).toContain('FAILED');
    expect(verdict.summary).toContain('test');
    const failed = verdict.checks?.find((c) => !c.passed);
    expect(failed?.detail).toBe('2 tests still red');
  });

  test('the runner is handed the run context (it can key the check on the run)', async () => {
    let seen: ObjectiveGateContext | undefined;
    const gate = gauntletObjectiveGate((ctx) => {
      seen = ctx;
      return { passed: true, checks: [] };
    });

    await gate.evaluate(context());

    expect(seen?.councilRunId).toBe('run-gate');
    expect(seen?.successCriterion).toBe('the repro goes green');
  });

  test('an async gauntlet runner is awaited', async () => {
    const gate = gauntletObjectiveGate(() =>
      Promise.resolve({
        passed: false,
        checks: [{ name: 'repro', status: 'failed' as const }],
      }),
    );

    const verdict = await gate.evaluate(context());
    expect(verdict.passed).toBe(false);
    expect(verdict.checks).toHaveLength(1);
  });
});
