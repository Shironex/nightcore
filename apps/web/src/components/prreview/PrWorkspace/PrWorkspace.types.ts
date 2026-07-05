/** Types for the PR Review workspace panel (the right side of the permanent
 *  two-panel layout). */
import type { PrStatus, PrSummary } from '@/lib/bridge';

import type { ReviewSectionProps } from '../ReviewSection';

export interface PrWorkspaceProps {
  /** The selected PR number — set even when `pr` is null (a typed number). */
  prNumber: number;
  /** The selected PR's summary from the open list, or null when the number was
   *  typed manually (closed / old / beyond the list cap). */
  pr: PrSummary | null;
  /** Open the PR on GitHub in the default browser. */
  onOpenExternal: (url: string) => void;
  /** The fully-assembled review-section props (built by the view model). */
  review: ReviewSectionProps;
  /** Story/test seam passed through to the status block (suppresses its fetch). */
  statusOverride?: PrStatus | null;
}
