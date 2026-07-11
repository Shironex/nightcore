/** Drift-v1 (T15) data seam: the wire→view normalizer for the measured
 *  per-convention conformance carried on `ArmedChecksState.drift`, plus the
 *  {@link useArmedDrift} fetch that reads it and hands it to the Enforce
 *  coverage panel. The panel JOINS these to its coverage records by
 *  `conventionFingerprint` (coverage answers "is there a rule?", drift answers "is
 *  it FOLLOWED at every site?"). No new bridge command — slice 2 already exposes
 *  `drift` on the checks state; this reuses `list_armed_checks`. Sibling of the
 *  coverage normalizers in `harness-coverage.ts`. */
import { useEffect, useState } from 'react';

import { type ConventionDrift, listArmedChecks } from '@/lib/bridge';

import type { ConventionDriftVM } from './harness.types';

/** Map a wire `ConventionDrift` (carried on `ArmedChecksState.drift`, string-typed
 *  `status`) into the view shape, narrowing the wire string to the
 *  `ConventionDriftStatus` union (mirrors `storedToCoverageGap`). */
export function driftToVM(d: ConventionDrift): ConventionDriftVM {
  return {
    id: d.id,
    conventionFingerprint: d.conventionFingerprint,
    category: d.category,
    title: d.title,
    status: d.status as ConventionDriftVM['status'],
    method: d.method,
    sitesMatched: d.sitesMatched,
    sitesChecked: d.sitesChecked,
    checkName: d.checkName ?? null,
    errorReason: d.errorReason ?? null,
    fingerprint: d.fingerprint,
  };
}

/** Read the active project's measured drift (the `drift` on the armed-checks state
 *  from the LAST EnforceRun) for the Enforce coverage panel. Gated on `active` so
 *  the fetch fires when the Conventions section is showing coverage AND re-fires
 *  each time the user returns to it — so a "Run armed checks now" performed on the
 *  Checks section is reflected on the next visit without a shared store. Drift is a
 *  supplementary signal: a failed read leaves the coverage panel intact and drift
 *  simply reads "not measured yet" (the honest empty state), never a fake "clean". */
export function useArmedDrift(active: boolean): ConventionDriftVM[] {
  const [drift, setDrift] = useState<ConventionDriftVM[]>([]);

  useEffect(() => {
    if (!active) return;
    let live = true;
    void (async () => {
      try {
        const state = await listArmedChecks();
        if (live) setDrift(state.drift.map(driftToVM));
      } catch {
        // Swallow — drift is supplementary; the coverage panel renders without it.
        if (live) setDrift([]);
      }
    })();
    return () => {
      live = false;
    };
  }, [active]);

  return drift;
}
