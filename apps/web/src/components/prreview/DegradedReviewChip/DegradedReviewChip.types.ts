/** Public types for the DegradedReviewChip component. */
import type { ReviewLens } from '@/lib/bridge';

export interface DegradedReviewChipProps {
  /** The lenses that errored in the displayed run (empty ⇒ renders nothing). */
  lenses: readonly ReviewLens[];
}
