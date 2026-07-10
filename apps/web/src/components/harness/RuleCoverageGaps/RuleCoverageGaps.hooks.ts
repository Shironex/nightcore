/** Derivation for the RuleCoverageGaps panel: the per-status summary + the
 *  actionable-first ordering. Pure (no run state) — the coverage records come in as
 *  a prop; kept in the hook so the component body stays a thin render shell. */
import { useMemo } from 'react';

import type { RuleCoverageGapVM } from '../harness.types';
import {
  COVERAGE_STATUS_ORDER,
  type RuleCoverageGapsViewModel,
} from './RuleCoverageGaps.types';

/** Resolve the coverage records into the panel's summary + ordered list. */
export function useRuleCoverageGaps(
  gaps: RuleCoverageGapVM[],
): RuleCoverageGapsViewModel {
  return useMemo(() => {
    const enforcingRules = new Set<string>();
    let enforced = 0;
    let documentedOnly = 0;
    let unenforced = 0;
    for (const gap of gaps) {
      if (gap.status === 'enforced') {
        enforced += 1;
        for (const rule of gap.enforcedBy) enforcingRules.add(rule);
      } else if (gap.status === 'documented-only') {
        documentedOnly += 1;
      } else {
        unenforced += 1;
      }
    }
    // Stable sort: actionable gaps first, then keep the incoming order within a status.
    const ordered = gaps
      .map((gap, index) => ({ gap, index }))
      .sort((a, b) => {
        const byStatus =
          COVERAGE_STATUS_ORDER[a.gap.status] - COVERAGE_STATUS_ORDER[b.gap.status];
        return byStatus !== 0 ? byStatus : a.index - b.index;
      })
      .map((entry) => entry.gap);

    return {
      summary: {
        total: gaps.length,
        enforced,
        documentedOnly,
        unenforced,
        enforcingRuleCount: enforcingRules.size,
      },
      ordered,
      hasCoverage: gaps.length > 0,
    };
  }, [gaps]);
}
