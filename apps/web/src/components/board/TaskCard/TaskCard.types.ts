import type { Task } from '@/lib/bridge';

/** The three card looks offered by the board's style switcher. */
export type CardStyle = 'glow' | 'flat' | 'outline';

export interface TaskCardProps {
  task: Task;
  selected: boolean;
  /** The board's current card look. */
  cardStyle?: CardStyle;
  /** True when this backlog task is blocked on an unfinished dependency. */
  blocked?: boolean;
  /** Number of streamed log lines, shown on the running card's Logs action. */
  logCount?: number;
  /** Open the detail drawer (also the card's click target). */
  onSelect: (id: string) => void;
  /** Real bridge actions. Absent in pure presentational stories. */
  onRun?: (id: string) => void;
  onCancel?: (id: string) => void;
  onDelete?: (id: string) => void;
}
