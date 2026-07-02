import type { ScanTarget } from '@/lib/source-ref';

/** Props for the ScorecardView surface: the active project's path/name and an optional board navigation. */
export interface ScorecardViewProps {
  /** The active project's absolute path (null when no project is active). */
  projectPath: string | null;
  /** The active project's display name. */
  projectName: string | null;
  /** Navigate to the board (used after hardening a reading into a task). */
  onGotoBoard?: () => void;
  /** A board→scan provenance target: the run + reading to load and open on
   *  mount (a task's `sourceRef` chip navigated here). Consumed once. */
  preselect?: ScanTarget | null;
  /** Acknowledge the preselect so routing clears it (it never refires). */
  onPreselectConsumed?: () => void;
}
