import type { ConventionCategory } from '@/lib/bridge';

/** One tab descriptor: the "All" pseudo-lens or a real convention lens, with its
 *  open finding count and whether its pass is still running. */
export interface CategoryTab {
  key: 'all' | ConventionCategory;
  count: number;
  running: boolean;
  errored: boolean;
}

export interface CategoryTabsProps {
  tabs: CategoryTab[];
  active: 'all' | ConventionCategory;
  onSelect: (key: 'all' | ConventionCategory) => void;
}
