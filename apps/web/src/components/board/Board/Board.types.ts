import type { Task } from '@/lib/bridge';

export interface BoardProps {
  tasks: Task[];
  /** Active project path + branch for the header subtitle. */
  projectPath: string;
  projectBranch: string | null;
  /** Persisted max-concurrency value (M2 — shown but not enforced yet). */
  concurrency: number;
  selectedId: string | null;
  /** Streamed log-line counts per task id (running card Logs badge). */
  logCounts: Record<string, number>;
  onSelect: (id: string) => void;
  onNewTask: () => void;
  onRun: (id: string) => void;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
  /** Clear all tasks in a column (Verified/Failed). */
  onClearColumn: (statuses: Task['status'][]) => void;
}
