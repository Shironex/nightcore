import type { ConventionFindingVM } from '../harness.types';

export interface ConventionDetailPanelProps {
  finding: ConventionFindingVM;
  pending: boolean;
  onClose: () => void;
  onDismiss: (findingId: string) => void;
  onRestore: (findingId: string) => void;
}
