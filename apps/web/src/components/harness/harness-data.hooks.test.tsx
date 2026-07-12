import { describe, expect, it } from 'vitest';

import type { HarnessRun } from '@/lib/bridge';

import { harnessScanConfig } from './harness-data.hooks';
import { EMPTY_HARNESS_STREAM, type HarnessStream } from './harness-stream';

/** A minimal persisted `HarnessRun`. The persisted shape drops the failure
 *  `reason`, so `streamFromRun(run).failureReason` is always `null` — which is
 *  exactly why `reconcileStream` has to re-derive it from `prev`. */
function harnessRun(over: Partial<HarnessRun> = {}): HarnessRun {
  return {
    id: 'r1',
    roundsByCategory: {},
    projectPath: '/proj',
    status: 'failed',
    categories: ['folder-structure'],
    model: 'm',
    createdAt: 1,
    updatedAt: 2,
    costUsd: 0,
    durationMs: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    profile: {
      isMonorepo: false,
      workspaceTool: 'single',
      packages: [],
      languages: [],
      frameworks: [],
      hasEslintFlatConfig: false,
      hasLintMeta: false,
      hasAgentDocs: false,
      existingPlugins: [],
    },
    findings: [],
    artifacts: [],
    proposals: [],
    coverage: [],
    synthesizing: false,
    error: null,
    ...over,
  };
}

function stream(over: Partial<HarnessStream> = {}): HarnessStream {
  return { ...EMPTY_HARNESS_STREAM, ...over };
}

describe('harnessScanConfig().reconcileStream', () => {
  const { reconcileStream } = harnessScanConfig();
  if (!reconcileStream) throw new Error('reconcileStream missing from harness scan config');

  it('preserves the live fold reason when reconciling the SAME run (cancel-preserving)', () => {
    // A user cancel: the live fold recorded `aborted` (neutral cancel notice).
    // The persisted run drops the reason, so a naive reconcile would revert the
    // neutral "cancelled" notice to a red failure banner. The same-run override
    // keeps `prev.failureReason` so the cancel notice survives the reconcile.
    const run = harnessRun({ id: 'r1' });
    const prev = stream({ runId: 'r1', failureReason: 'aborted' });

    const next = reconcileStream(run, prev);

    expect(next.failureReason).toBe('aborted');
    // The rest of the stream still comes authoritatively from the persisted run.
    expect(next.runId).toBe('r1');
    expect(next.status).toBe('failed');
  });

  it('does NOT carry a stale reason across a DIFFERENT run', () => {
    // The reconciled run is a fresh id — `prev`'s cancel reason must not bleed
    // onto it. The new run's own state (status/error) is what surfaces; its
    // failure reason resets to null (the persisted run carries none of its own).
    const run = harnessRun({ id: 'r2', status: 'failed', error: 'sidecar died' });
    const prev = stream({ runId: 'r1', failureReason: 'aborted' });

    const next = reconcileStream(run, prev);

    expect(next.failureReason).toBeNull();
    expect(next.runId).toBe('r2');
    expect(next.status).toBe('failed');
    expect(next.error).toBe('sidecar died');
  });
});
