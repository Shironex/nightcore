/** Types for the RuleCoverageGaps panel. */
import type { CoverageStatus } from '@/lib/bridge';

import type { RuleCoverageGapVM } from '../harness.types';

/** Props for {@link RuleCoverageGaps}: the ENFORCE-lite coverage records for the
 *  displayed run (one per convention). Rendered only in the Enforce destination. */
export interface RuleCoverageGapsProps {
  gaps: RuleCoverageGapVM[];
}

/** The per-status tallies + the distinct enforcing-rule count the panel header shows. */
export interface CoverageSummary {
  total: number;
  enforced: number;
  documentedOnly: number;
  unenforced: number;
  /** Distinct enforcing rule ids across every `enforced` record — the "inventory:
   *  N rules found" count, derived from the coverage itself. */
  enforcingRuleCount: number;
}

/** The resolved view model {@link RuleCoverageGaps} renders from. */
export interface RuleCoverageGapsViewModel {
  summary: CoverageSummary;
  /** The gaps ordered actionable-first: `unenforced` → `documented-only` → `enforced`. */
  ordered: RuleCoverageGapVM[];
  /** Whether there is anything to render (a run with coverage). */
  hasCoverage: boolean;
}

/** The display order weight per status (lower = shown first — the actionable gaps). */
export const COVERAGE_STATUS_ORDER: Record<CoverageStatus, number> = {
  unenforced: 0,
  'documented-only': 1,
  enforced: 2,
};
