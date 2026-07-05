/** Props for the IssueList — the left-pane list of a project's open GitHub issues
 *  with a client-side filter, per-issue validation badges, and the house-style
 *  loading/error/empty states. All state (filter, selection) is owned upstream by
 *  the IssueTriageView hook; this is a thin presentational shell. */
import type { IssueSummary } from '@/lib/bridge';

/** The validation state a list row badges (absent = never validated). `stale` means
 *  the issue was updated on GitHub after its last validation. */
export type IssueValidationBadge = 'validated' | 'stale';

export interface IssueListProps {
  /** Issues to render — already filtered by the parent (client-side). */
  issues: IssueSummary[];
  /** Total unfiltered issue count, so the empty state can tell "no open issues"
   *  from "no issues match your filter". */
  totalCount: number;
  loading: boolean;
  /** A `gh` failure message (not a repo / gh missing / auth), or `null`. */
  error: string | null;
  filter: string;
  onFilterChange: (value: string) => void;
  /** The selected issue's number, or `null`. */
  selectedNumber: number | null;
  onSelect: (issue: IssueSummary) => void;
  /** Re-fetch the issue list (shown on error and empty states). */
  onRetry: () => void;
  /** Per-issue validation badge keyed by issue number. */
  badgeByNumber: Record<number, IssueValidationBadge>;
}
