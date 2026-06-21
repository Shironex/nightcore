import type { DragEvent } from 'react';
import type { Task } from '@/lib/bridge';

export interface TaskCardProps {
  task: Task;
  selected: boolean;
  /** True when this backlog task is blocked on an unfinished dependency. */
  blocked?: boolean;
  /** True when the running task has a parked permission prompt — pulses the card
   *  and surfaces a "needs approval" chip. */
  needsApproval?: boolean;
  /** Number of streamed log lines, shown on the running card's Logs action. */
  logCount?: number;
  /** Whether the card can be dragged between columns (HTML5 DnD). */
  draggable?: boolean;
  /** Drag-start handler that stamps the task id onto the drag's dataTransfer. */
  onDragStart?: (e: DragEvent) => void;
  /** Open the detail drawer (also the card's click target). */
  onSelect: (id: string) => void;
  /** Real bridge actions. Absent in pure presentational stories. */
  onRun?: (id: string) => void;
  onCancel?: (id: string) => void;
  onDelete?: (id: string) => void;
  /** Waiting Approval actions (Approve / Refine). */
  onApprove?: (id: string) => void;
  onRefine?: (id: string) => void;
  /** Verified actions (Commit / Merge). */
  onCommit?: (id: string) => void;
  onMerge?: (id: string) => void;
}
