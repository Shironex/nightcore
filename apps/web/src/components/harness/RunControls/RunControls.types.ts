import type { ConventionCategory } from '@/lib/bridge';
import type { HarnessStream } from '../harness-stream';

export interface RunControlsProps {
  stream: HarnessStream;
  isStarting: boolean;
  disabled: boolean;
  onScan: (
    categories: ConventionCategory[],
    model: string | null,
    effort: string | null,
  ) => void;
  onCancel: () => void;
}
