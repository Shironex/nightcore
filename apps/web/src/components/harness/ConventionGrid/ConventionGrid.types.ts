import type { ConventionFindingVM } from '../harness.types';

export interface ConventionGridProps {
  findings: ConventionFindingVM[];
  /** Number of skeleton placeholder cards to show below real ones (lenses still
   *  streaming in the active view). */
  skeletonCount: number;
  /** Shown when there are no findings and nothing is streaming. */
  emptyMessage: string;
  onOpen: (finding: ConventionFindingVM) => void;
}
