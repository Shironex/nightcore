import type { ProposedArtifactVM } from '../harness.types';

export interface ArtifactDetailPanelProps {
  artifact: ProposedArtifactVM;
  pending: boolean;
  onClose: () => void;
  /** Request to apply the artifact — opens the ApplyConfirmDialog upstream. */
  onApply: (artifactId: string) => void;
  onDismiss: (artifactId: string) => void;
  onRestore: (artifactId: string) => void;
}
