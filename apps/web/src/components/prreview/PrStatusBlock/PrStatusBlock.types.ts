/** Types for the PR Review workspace status block. */
import type { PrStatus } from '@/lib/bridge';

/** Props for the {@link PrStatusBlock}: the PR number to fetch live status for.
 *  The block owns its own fetch (`pr_status_by_number`) — fetch on selection +
 *  manual refresh only, NO polling. */
export interface PrStatusBlockProps {
  /** The selected PR's number (the fetch re-keys when it changes). */
  prNumber: number;
  /** Story/test seam: when provided (including `null` = unavailable), no fetch
   *  ever fires and the block renders this snapshot directly. */
  override?: PrStatus | null;
}
