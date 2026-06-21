import type { PermissionPrompt, Task } from '@/lib/bridge';
import type { SessionStream } from '../session-stream';

export interface TaskDetailProps {
  task: Task;
  stream: SessionStream | undefined;
  /** True when ANY task is in_progress (serial-run guard). */
  anyRunning: boolean;
  /** Parked permission prompts for this task (interactive approval). */
  prompts?: PermissionPrompt[];
  onClose: () => void;
  onRun: (id: string) => void;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
  /** Answer a parked permission prompt. */
  onRespondPermission?: (taskId: string, requestId: string, decision: 'allow' | 'deny') => void;
  /** Plan-approval actions (shown when the task is `waiting_approval`). */
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  onRefine?: (id: string) => void;
}
