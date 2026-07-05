/** Props for the ResultsPanel — the validation verdict card (kind + verdict +
 *  confidence), reasoning, grounded related files, complexity, proposed plan, missing
 *  info, linked-PR analysis, and the human-gated Post-as-comment / Convert-to-task
 *  actions. Renders only when the stream carries a verdict; the parent gates it. */
import type { IssueTriageStream } from '../issue-stream';

export interface ResultsPanelProps {
  /** The active validation stream for the selected issue (must carry a verdict). */
  stream: IssueTriageStream;
  /** True when the issue changed on GitHub since this validation — badges it stale. */
  stale: boolean;
  /** Open the post-comment preview dialog. */
  onPostComment: () => void;
  /** Open the convert-to-task dialog. */
  onConvertToTask: () => void;
  /** Navigate to the linked board task (for an already-converted validation). */
  onGotoBoard?: () => void;
}
