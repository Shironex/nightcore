/** Prop types for the top-level HarnessView component. */
import type { ScanTarget } from '@/lib/source-ref';

/** Props for the HarnessView shell: the active project's path and display name. */
export interface HarnessViewProps {
  /** The active project's absolute path (null when no project is active). */
  projectPath: string | null;
  /** The active project's display name. */
  projectName: string | null;
  /** Navigate to the board (used after convert-to-task). */
  onGotoBoard?: () => void;
  /** A board→scan provenance target: the run + item to load and open on mount
   *  (a task's `sourceRef` chip navigated here). `kind` picks the section —
   *  a convention finding or a task-shaped proposal. Consumed once. */
  preselect?: ScanTarget | null;
  /** Acknowledge the preselect so routing clears it (it never refires). */
  onPreselectConsumed?: () => void;
}
