/** Props for the top-level IssueTriageView component. Mirrors the scan siblings
 *  (Insight / PR Review) so the AppShell wires it identically. */
import type { ScanTarget } from '@/lib/source-ref';

export interface IssueTriageViewProps {
  /** The active project's absolute path (null when no project is active). */
  projectPath: string | null;
  /** The active project's display name. */
  projectName: string | null;
  /** Navigate to the board (used after convert-to-task). */
  onGotoBoard?: () => void;
  /** A board→triage provenance target: the validation run to load and open on mount
   *  (a task's `sourceRef` chip navigated here). Consumed once. Run-level — no item. */
  preselect?: ScanTarget | null;
  /** Acknowledge the preselect so routing clears it (it never refires). */
  onPreselectConsumed?: () => void;
}
