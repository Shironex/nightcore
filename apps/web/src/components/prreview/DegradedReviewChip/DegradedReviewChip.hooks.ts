/** Pure copy helpers for the DegradedReviewChip. */
import type { ReviewLens } from '@/lib/bridge';

import { LENS_META } from '../prreview.constants';

/** The comma-joined human labels for the errored lenses (e.g. "Security, Logic"). */
export function degradedLensLabels(lenses: readonly ReviewLens[]): string {
  return lenses.map((lens) => LENS_META[lens].label).join(', ');
}
