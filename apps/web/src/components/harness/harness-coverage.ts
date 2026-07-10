/** ENFORCE-lite coverage normalizers: map the two sources for a `RuleCoverageGap`
 *  — the live wire `RuleCoverageGap` (contract) and the persisted
 *  `StoredRuleCoverageGap` (ts-rs) — into the single {@link RuleCoverageGapVM} the
 *  UI renders. Split out of `harness-stream.ts` to keep that file under the web
 *  file-size ratchet. Coverage, not conformance. */
import type { RuleCoverageGap, StoredRuleCoverageGap } from '@/lib/bridge';

import type { RuleCoverageGapVM } from './harness.types';

/** Map a live wire `RuleCoverageGap` (contract) into the view shape. */
export function wireToCoverageGap(c: RuleCoverageGap): RuleCoverageGapVM {
  return {
    id: c.id,
    conventionFingerprint: c.conventionFingerprint,
    category: c.category,
    title: c.title,
    status: c.status,
    enforcedBy: c.enforcedBy ?? [],
    documentedIn: c.documentedIn ?? [],
    suggestedArtifactKind: c.suggestedArtifactKind ?? null,
    fingerprint: c.fingerprint,
  };
}

/** Map a persisted `StoredRuleCoverageGap` (string-typed `status`) into the view
 *  shape, narrowing the wire string to the `CoverageStatus` union. */
export function storedToCoverageGap(c: StoredRuleCoverageGap): RuleCoverageGapVM {
  return {
    id: c.id,
    conventionFingerprint: c.conventionFingerprint,
    category: c.category,
    title: c.title,
    status: c.status as RuleCoverageGapVM['status'],
    enforcedBy: c.enforcedBy,
    documentedIn: c.documentedIn,
    suggestedArtifactKind: c.suggestedArtifactKind,
    fingerprint: c.fingerprint,
  };
}
