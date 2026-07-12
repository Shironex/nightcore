/**
 * The PR-review verdict CLAMP + severity rubric (review-calibration slice 1).
 *
 * The merge-verdict synthesis pass lets the model PROPOSE an overall verdict, but the
 * model has no mechanical floor — a miscalibrated "ready" on a high-severity finding
 * could slip through. {@link clampVerdict} is a pure, unit-testable transform that
 * bounds the model's proposal to a `[floor, ceiling]` band derived from the WORST
 * calibrated finding severity present. The model still picks WITHIN the band; a choice
 * outside the band clamps to the nearest boundary AND records why (surfaced as the
 * `verdictClamped` / `clampReason` fields on the completed event).
 *
 * The band table ({@link VERDICT_BANDS_BY_WORST_SEVERITY}) is the SEVERITY RUBRIC.
 * Per the spec, the MECHANISM ships now with sensible default thresholds while the
 * thresholds stay tunable — a named constant tuned later against the T9 E2E harness,
 * not in this slice. Severity meaning is preserved: the clamp reads severities, it
 * never mutates them (corroboration/ranking live in later slices and do not touch this).
 *
 * Kept pure (only contract types + the shared severity rank; no SDK, no emitter) so a
 * verdict decision can never crash a review and every band is testable in isolation.
 */
import type { MergeVerdict, ReviewFinding, ReviewSeverity } from '@nightcore/contracts';

import { severityRank } from '../shared/findings.js';

/**
 * The four {@link MergeVerdict} values ordered mergeable → blocked. The clamp bands
 * index into this order, so a verdict's "position" is its index (0 = `ready`,
 * 3 = `blocked`) and clamping is a numeric min/max against the band boundaries.
 */
export const MERGE_VERDICT_ORDER: readonly MergeVerdict[] = [
  'ready',
  'merge_with_changes',
  'needs_revision',
  'blocked',
];

/** One allowed band over {@link MERGE_VERDICT_ORDER}: the softest (`floor`) and
 *  hardest (`ceiling`) verdict the model may land on for a given worst severity. */
export interface VerdictBand {
  floor: MergeVerdict;
  ceiling: MergeVerdict;
}

/**
 * The calibrated severity → verdict-band RUBRIC, keyed on the WORST finding severity
 * present. These are the DEFAULT thresholds — intentionally a named constant so tuning
 * happens later against real-run data (spec: threshold tuning is out of slice 1), not
 * scattered through the clamp logic. Encodes the spec's locked table:
 *
 *  - `critical` ⇒ `blocked` only.
 *  - `high`     ⇒ floor at `needs_revision` (can't be softer; ceiling `blocked`).
 *  - `medium`   ⇒ `merge_with_changes`‥`needs_revision`.
 *  - `low`/`info` ⇒ ceiling at `merge_with_changes` (NEVER `needs_revision`/`blocked`).
 *
 * The no-findings case is handled separately ({@link NO_FINDINGS_BAND}).
 */
export const VERDICT_BANDS_BY_WORST_SEVERITY: Record<ReviewSeverity, VerdictBand> = {
  info: { floor: 'ready', ceiling: 'merge_with_changes' },
  low: { floor: 'ready', ceiling: 'merge_with_changes' },
  medium: { floor: 'merge_with_changes', ceiling: 'needs_revision' },
  high: { floor: 'needs_revision', ceiling: 'blocked' },
  critical: { floor: 'blocked', ceiling: 'blocked' },
};

/** With NO findings there is nothing to block on — the verdict is pinned to `ready`. */
export const NO_FINDINGS_BAND: VerdictBand = { floor: 'ready', ceiling: 'ready' };

/** The result of {@link clampVerdict}: the final (possibly clamped) verdict, whether
 *  it was clamped, and — only when clamped — the human-readable reason. */
export interface ClampVerdictResult {
  /** The verdict after clamping — the model's proposal when in-band, else the nearest
   *  band boundary. */
  verdict: MergeVerdict;
  /** True when the model's proposal fell outside the band and was overridden. */
  clamped: boolean;
  /** Why the clamp fired — present ONLY when `clamped` is true. */
  reason?: string;
}

/** The band allowed for a finding set: the worst severity present picks the row of
 *  {@link VERDICT_BANDS_BY_WORST_SEVERITY}, or {@link NO_FINDINGS_BAND} when empty. */
export function verdictBandForFindings(
  findings: readonly ReviewFinding[],
): VerdictBand {
  const worst = worstSeverity(findings);
  return worst === undefined
    ? NO_FINDINGS_BAND
    : VERDICT_BANDS_BY_WORST_SEVERITY[worst];
}

/**
 * Clamp the model's proposed verdict to the mechanical band derived from the
 * calibrated finding severities. Returns the model's verdict unchanged when it is
 * inside `[floor, ceiling]`; otherwise the nearest boundary, with `clamped: true` and
 * a `reason` describing the override. Pure + total — never throws.
 */
export function clampVerdict(
  modelVerdict: MergeVerdict,
  findings: readonly ReviewFinding[],
): ClampVerdictResult {
  const band = verdictBandForFindings(findings);
  const floorIdx = MERGE_VERDICT_ORDER.indexOf(band.floor);
  const ceilingIdx = MERGE_VERDICT_ORDER.indexOf(band.ceiling);
  const proposedIdx = MERGE_VERDICT_ORDER.indexOf(modelVerdict);
  const worst = worstSeverity(findings);
  const because =
    worst === undefined
      ? 'the review surfaced no findings'
      : `the worst finding severity is "${worst}"`;

  if (proposedIdx < floorIdx) {
    return {
      verdict: band.floor,
      clamped: true,
      reason: `model proposed "${modelVerdict}" but ${because}, which floors the verdict at "${band.floor}"`,
    };
  }
  if (proposedIdx > ceilingIdx) {
    return {
      verdict: band.ceiling,
      clamped: true,
      reason: `model proposed "${modelVerdict}" but ${because}, which caps the verdict at "${band.ceiling}"`,
    };
  }
  return { verdict: modelVerdict, clamped: false };
}

/** The highest-ranked severity across the findings, or `undefined` when empty. Uses
 *  the shared rank table so the "worst" ordering matches every other scan surface. */
function worstSeverity(findings: readonly ReviewFinding[]): ReviewSeverity | undefined {
  let worst: ReviewSeverity | undefined;
  let worstRank = -1;
  for (const finding of findings) {
    const rank = severityRank(finding.severity);
    if (rank > worstRank) {
      worstRank = rank;
      worst = finding.severity;
    }
  }
  return worst;
}
