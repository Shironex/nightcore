/** Props for the ReviewFindings results grid. */
import type { ReviewFindingView } from '../prreview.types';

/** Props for the ReviewFindings grid: the findings to render (grouped by severity),
 *  the empty message, and the selection + open handlers. The grid renders only in
 *  the section's RESULTS mode, so it carries no streaming-skeleton wiring. */
export interface ReviewFindingsProps {
  /** The findings to render as cards, grouped into severity sections. */
  findings: ReviewFindingView[];
  /** Shown when there are no findings. */
  emptyMessage: string;
  /** The set of finding ids selected for the posted review. */
  selection: ReadonlySet<string>;
  /** Toggle a finding in/out of the selection. */
  onToggleSelect: (findingId: string) => void;
  /** Open a finding's detail panel. */
  onOpen: (finding: ReviewFindingView) => void;
}
