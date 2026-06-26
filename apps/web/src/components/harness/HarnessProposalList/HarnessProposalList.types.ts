import type { ProposedArtifactVM } from '../harness.types';

export interface HarnessProposalListProps {
  artifacts: ProposedArtifactVM[];
  /** True while a scan runs and the synthesis pass hasn't emitted yet (skeleton). */
  loading: boolean;
  /** Shown when there are no artifacts and nothing is streaming. */
  emptyMessage: string;
  onOpen: (artifact: ProposedArtifactVM) => void;
}
