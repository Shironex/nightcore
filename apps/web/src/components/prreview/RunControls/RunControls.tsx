/** The PR Review CONFIGURE screen: a master-detail browser — the project's open
 *  PRs on the left, the selected PR (labels, description) plus the run config and
 *  the Review action on the right. Fetches the open-PR list once per appearance. */
import { openExternal } from '@/lib/bridge';

import { PrDetail } from '../PrDetail';
import { PrPicker } from '../PrPicker';
import { useOpenPrs } from './RunControls.hooks';
import type { RunControlsProps } from './RunControls.types';

export function RunControls({ config, isStarting, onReview }: RunControlsProps) {
  const openPrs = useOpenPrs();
  // The selected PR's full summary, when the chosen number is one of the fetched
  // open PRs (a typed number for a PR beyond the list leaves this null — the
  // detail pane still offers the review by number).
  const selectedPr =
    config.prNumberValue === null
      ? null
      : (openPrs.prs.find((pr) => pr.number === config.prNumberValue) ?? null);

  return (
    <div className="grid h-full min-h-0 grid-cols-[380px_1fr] overflow-hidden">
      <div className="flex min-h-0 flex-col overflow-hidden border-r border-border">
        <PrPicker
          prs={openPrs.prs}
          loading={openPrs.loading}
          error={openPrs.error}
          value={config.prNumberValue}
          onChange={(n) => config.setPrNumber(n === null ? '' : String(n))}
          onRefresh={openPrs.refresh}
          disabled={isStarting}
        />
      </div>
      <div className="min-h-0 overflow-y-auto">
        <PrDetail
          pr={selectedPr}
          selectedNumber={config.prNumberValue}
          config={config}
          isStarting={isStarting}
          onReview={onReview}
          onOpenExternal={(url) => void openExternal(url)}
        />
      </div>
    </div>
  );
}
