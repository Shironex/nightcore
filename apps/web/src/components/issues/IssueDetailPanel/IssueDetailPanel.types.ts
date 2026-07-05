/** Props for the IssueDetailPanel — the selected issue's header, body, and first
 *  page of comments. The body/comment markdown is untrusted GitHub content; the panel
 *  renders it through the sanitized `<Markdown>` framing. Data + fetch state are owned
 *  upstream by the IssueTriageView hook. */
import type { IssueDetail, IssueSummary } from '@/lib/bridge';

export interface IssueDetailPanelProps {
  /** The selected issue (list-view summary), or `null` when nothing is selected. */
  issue: IssueSummary | null;
  /** The fetched body + comments, or `null` while loading / on error. */
  detail: IssueDetail | null;
  loading: boolean;
  /** A `gh` failure message fetching the detail, or `null`. */
  error: string | null;
}
