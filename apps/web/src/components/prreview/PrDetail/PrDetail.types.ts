/** Types for the PR Review detail pane (the right side of the master-detail). */
import type { PrSummary } from '@/lib/bridge';

import type { PrReviewRunConfig } from '../RunControls';

export interface PrDetailProps {
  /** The selected PR's full summary, or null when nothing is selected (or a bare
   *  number was typed for a PR not in the fetched list). */
  pr: PrSummary | null;
  /** The chosen PR number — set even when `pr` is null (a typed number). */
  selectedNumber: number | null;
  /** The lifted run-config (lens selection + model/effort). */
  config: PrReviewRunConfig;
  /** True between the Review click and the optimistic running swap. */
  isStarting: boolean;
  /** Start a review of the selected PR with the current config. */
  onReview: () => void;
  /** Open the PR on GitHub in the default browser. */
  onOpenExternal: (url: string) => void;
}
