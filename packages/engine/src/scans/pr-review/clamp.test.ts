/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import type { MergeVerdict, ReviewFinding, ReviewSeverity } from '@nightcore/contracts';

import {
  clampVerdict,
  NO_FINDINGS_BAND,
  VERDICT_BANDS_BY_WORST_SEVERITY,
  verdictBandForFindings,
} from './clamp.js';

/** A minimal finding at a given severity — only `severity` matters to the clamp. */
function finding(severity: ReviewSeverity): ReviewFinding {
  return {
    id: `id-${severity}`,
    lens: 'security',
    severity,
    file: 'a.ts',
    title: `t-${severity}`,
    body: 'b',
    fingerprint: `fp-${severity}`,
  };
}

describe('verdictBandForFindings', () => {
  test('bands on the WORST severity present, not the first or last', () => {
    // low + critical + medium → the critical row.
    const band = verdictBandForFindings([
      finding('low'),
      finding('critical'),
      finding('medium'),
    ]);
    expect(band).toEqual(VERDICT_BANDS_BY_WORST_SEVERITY.critical);
  });

  test('pins the empty finding set to the ready-only band', () => {
    expect(verdictBandForFindings([])).toEqual(NO_FINDINGS_BAND);
  });
});

describe('clampVerdict — mechanical bands', () => {
  test('critical ⇒ blocked (any softer proposal clamps up to blocked)', () => {
    for (const proposal of [
      'ready',
      'merge_with_changes',
      'needs_revision',
    ] as MergeVerdict[]) {
      const result = clampVerdict(proposal, [finding('critical')]);
      expect(result.verdict).toBe('blocked');
      expect(result.clamped).toBe(true);
      expect(result.reason).toContain('critical');
    }
    // An in-band `blocked` passes through unchanged.
    const inBand = clampVerdict('blocked', [finding('critical')]);
    expect(inBand).toEqual({ verdict: 'blocked', clamped: false });
  });

  test('high ⇒ floor at needs_revision (a softer proposal clamps up)', () => {
    const floored = clampVerdict('merge_with_changes', [finding('high')]);
    expect(floored.verdict).toBe('needs_revision');
    expect(floored.clamped).toBe(true);
    expect(floored.reason).toContain('high');
    expect(floored.reason).toContain('needs_revision');

    // The model may still pick the harder `blocked` within [needs_revision, blocked].
    expect(clampVerdict('blocked', [finding('high')])).toEqual({
      verdict: 'blocked',
      clamped: false,
    });
    // ...and an in-band `needs_revision` passes through.
    expect(clampVerdict('needs_revision', [finding('high')])).toEqual({
      verdict: 'needs_revision',
      clamped: false,
    });
  });

  test('lows-only ⇒ ceiling at merge_with_changes (NEVER needs_revision/blocked)', () => {
    for (const proposal of ['needs_revision', 'blocked'] as MergeVerdict[]) {
      const capped = clampVerdict(proposal, [finding('low'), finding('info')]);
      expect(capped.verdict).toBe('merge_with_changes');
      expect(capped.clamped).toBe(true);
      expect(capped.reason).toContain('caps');
    }
    // `ready` and `merge_with_changes` are both in-band for lows-only.
    expect(clampVerdict('ready', [finding('low')]).clamped).toBe(false);
    expect(clampVerdict('merge_with_changes', [finding('low')]).clamped).toBe(false);
  });

  test('medium ⇒ merge_with_changes‥needs_revision (both boundaries clamp)', () => {
    // `ready` is below the floor.
    const floored = clampVerdict('ready', [finding('medium')]);
    expect(floored.verdict).toBe('merge_with_changes');
    expect(floored.clamped).toBe(true);
    // `blocked` is above the ceiling.
    const capped = clampVerdict('blocked', [finding('medium')]);
    expect(capped.verdict).toBe('needs_revision');
    expect(capped.clamped).toBe(true);
    // In-band picks pass through.
    expect(clampVerdict('needs_revision', [finding('medium')]).clamped).toBe(false);
  });

  test('no findings ⇒ ready (anything harder clamps down to ready)', () => {
    const clampedDown = clampVerdict('needs_revision', []);
    expect(clampedDown.verdict).toBe('ready');
    expect(clampedDown.clamped).toBe(true);
    expect(clampVerdict('ready', [])).toEqual({ verdict: 'ready', clamped: false });
  });

  test('records a clamp reason ONLY when the proposal is out of band', () => {
    const inBand = clampVerdict('needs_revision', [finding('high')]);
    expect(inBand.reason).toBeUndefined();

    const outOfBand = clampVerdict('ready', [finding('high')]);
    expect(outOfBand.reason).toBeDefined();
    // The reason names both the model's proposal and the resulting boundary.
    expect(outOfBand.reason).toContain('ready');
    expect(outOfBand.reason).toContain('needs_revision');
  });
});
