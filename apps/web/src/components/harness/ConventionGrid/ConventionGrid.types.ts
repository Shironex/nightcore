/** Types for the ConventionGrid. */
import type { CoverageStatus } from '@/lib/bridge';

import type { ConventionFindingVM } from '../harness.types';

/** Props for {@link ConventionGrid}: the findings to render, the streaming
 *  skeleton count, the empty-state message, and the open-finding callback. */
export interface ConventionGridProps {
  findings: ConventionFindingVM[];
  /** Number of skeleton placeholder cards to show below real ones (lenses still
   *  streaming in the active view). */
  skeletonCount: number;
  /** Shown when there are no findings and nothing is streaming. */
  emptyMessage: string;
  onOpen: (finding: ConventionFindingVM) => void;
  /** ENFORCE-lite coverage status per convention `fingerprint` — when provided (the
   *  Enforce destination), each card shows an `enforced / documented-only /
   *  unenforced` coverage badge. Omitted elsewhere (no badge). */
  coverageByFingerprint?: Record<string, CoverageStatus>;
}
