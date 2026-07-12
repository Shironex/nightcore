/**
 * Shared DEEP-mode (issue #294) constants for the scan families. The Standard/Deep
 * toggle copy and the explicit per-run config are identical across Insight, Harness,
 * and PR-Review, so they live here in `@/lib/scan-run` — the one place the
 * `no-cross-feature-imports` lint permits cross-family sharing — instead of being
 * cloned per feature.
 */
import type { DeepScanConfig } from '@/lib/bridge';

/** Label + hint for the Standard/Deep 2-chip radio (issue #294), keyed by the `deep`
 *  boolean as a string so it fits the same shape `SCOPE_META` uses. `unitNoun` fills the
 *  hint so each family reads naturally (Insight "category", Harness "lens", PR-Review
 *  "lens"). */
export function deepModeMeta(
  unitNoun: string,
): Record<'standard' | 'deep', { label: string; hint: string }> {
  return {
    standard: { label: 'Standard', hint: `One pass per ${unitNoun}` },
    deep: {
      label: 'Deep',
      hint: `Multiple rounds per ${unitNoun} until convergence — can run long`,
    },
  };
}

/** Deep mode's explicit per-run parameters (issue #294). MUST be sent with every field
 *  present — the generated Rust `DeepScanConfig` fields default to `0` on deserialize
 *  (not these zod schema defaults), so an empty `{}` would silently zero the round count
 *  / cap and produce a 0-round scan. Mirrors `DeepScanConfigSchema`'s zod defaults
 *  (15 rounds, 2-round convergence, 20 findings/round). */
export const DEFAULT_DEEP_SCAN_CONFIG: DeepScanConfig = {
  maxRoundsPerCategory: 15,
  convergenceEmptyRounds: 2,
  maxFindingsPerRound: 20,
};
