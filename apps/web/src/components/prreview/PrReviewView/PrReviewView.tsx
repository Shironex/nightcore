/** Top-level PR Review surface: a PERMANENT two-panel workspace — the project's
 *  open PRs on the left (with live per-PR run badges), the selected PR's
 *  workspace (header / status / description / registry-driven review section)
 *  on the right — plus the finding detail panel and the human-gated post-review
 *  ConfirmDialog from the `usePrReviewView` model. Selecting a PR never cancels
 *  anything: every run keeps streaming in the run registry. */
import {
  Button,
  ConfirmDialog,
  EmptyState,
  FolderIcon,
  GithubIcon,
  RetryIcon,
  Spinner,
} from '@/components/ui';

import { FindingDetailPanel } from '../FindingDetailPanel';
import { PrPicker } from '../PrPicker';
import { VERDICT_META } from '../prreview.constants';
import { PrWorkspace } from '../PrWorkspace';
import { usePrReviewView } from './PrReviewView.hooks';
import type { PrReviewViewProps } from './PrReviewView.types';

export function PrReviewView(props: PrReviewViewProps) {
  const view = usePrReviewView(props);

  if (!view.hasProject) {
    return (
      <EmptyState
        icon={<FolderIcon size={32} />}
        title="No active project"
        description="Open a project to review its pull requests. PR Review reviews a PR of the active project's repo."
      />
    );
  }

  const verdictMeta = view.postVerdict !== null ? VERDICT_META[view.postVerdict] : null;

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        {/* Header bar: title + project + the Refresh-PRs action. */}
        <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="flex items-center gap-2 truncate text-sm font-semibold text-foreground">
              <GithubIcon size={16} />
              PR Review
            </h2>
            <span className="truncate text-[12px] text-muted-foreground">
              {view.projectName ?? 'Pull-request review'}
            </span>
          </div>
          <Button
            variant="ghost"
            onClick={view.refreshPrs}
            disabled={view.prsLoading}
            aria-busy={view.prsLoading}
          >
            {view.prsLoading ? <Spinner size={14} /> : <RetryIcon size={14} />}
            Refresh PRs
          </Button>
        </header>

        {/* The permanent two-panel body. */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside className="flex min-h-0 w-[380px] shrink-0 flex-col overflow-hidden border-r border-border">
            <PrPicker
              prs={view.prs}
              loading={view.prsLoading}
              error={view.prsError}
              value={view.selectedPr}
              onChange={view.selectPr}
              onRefresh={view.refreshPrs}
              runningPrs={view.runningPrs}
              findingCounts={view.prFindingCounts}
            />
          </aside>
          <main className="min-h-0 flex-1 overflow-y-auto">
            {view.selectedPr === null || view.review === null ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <GithubIcon size={44} className="text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  Select a pull request to review
                </p>
              </div>
            ) : (
              <PrWorkspace
                prNumber={view.selectedPr}
                pr={view.selectedSummary}
                onOpenExternal={view.onOpenExternal}
                review={view.review}
              />
            )}
          </main>
        </div>
      </div>

      {view.selected !== null && (
        <FindingDetailPanel
          finding={view.selected}
          pending={view.pending}
          onClose={view.closeFinding}
          onConvert={view.onConvert}
          onDismiss={view.onDismiss}
          onRestore={view.onRestore}
          onGotoBoard={view.onGotoBoard}
        />
      )}

      {view.postVerdict !== null && verdictMeta !== null && (
        <ConfirmDialog
          title={verdictMeta.confirmTitle}
          confirmLabel={verdictMeta.confirmLabel}
          destructive={verdictMeta.destructive}
          busy={view.posting}
          onConfirm={view.confirmPost}
          onCancel={view.cancelPost}
          message={
            <div className="flex flex-col gap-2">
              <span>
                Post{' '}
                <span className="font-semibold text-foreground">
                  {verdictMeta.label.toLowerCase()}
                </span>{' '}
                on{' '}
                <span className="font-mono text-foreground">
                  PR #{view.postPrNumber}
                </span>{' '}
                with{' '}
                <span className="font-semibold text-foreground">
                  {view.selectedCount}
                </span>{' '}
                selected {view.selectedCount === 1 ? 'finding' : 'findings'}
                {view.selectedInlineCount > 0
                  ? ` (${view.selectedInlineCount} inline ${
                      view.selectedInlineCount === 1 ? 'comment' : 'comments'
                    })`
                  : ''}
                ?
              </span>
              {view.postError !== null && (
                <span
                  role="alert"
                  className="rounded-md border border-destructive/40 bg-destructive/[0.1] px-3 py-2 text-[12.5px] text-destructive"
                >
                  {view.postError}
                </span>
              )}
            </div>
          }
        />
      )}

      {/* Address-findings human gate: starting a PAID agent session that will
          COMMIT to the PR branch never auto-fires. Pushing stays a separate,
          separately-gated manual step. */}
      {view.addressArmed && (
        <ConfirmDialog
          title={`Address findings on PR #${view.addressPrNumber}?`}
          confirmLabel="Start fix agent"
          busy={view.addressing}
          onConfirm={view.confirmAddress}
          onCancel={view.cancelAddress}
          message={
            <div className="flex flex-col gap-2">
              <span>
                Run a fix agent on{' '}
                <span className="font-mono text-foreground">
                  PR #{view.addressPrNumber}
                </span>
                &apos;s branch addressing{' '}
                <span className="font-semibold text-foreground">
                  {view.addressCount}
                </span>{' '}
                selected {view.addressCount === 1 ? 'finding' : 'findings'}? It
                will commit to the branch; pushing stays a separate manual step.
              </span>
              {view.addressError !== null && (
                <span
                  role="alert"
                  className="rounded-md border border-destructive/40 bg-destructive/[0.1] px-3 py-2 text-[12.5px] text-destructive"
                >
                  {view.addressError}
                </span>
              )}
            </div>
          }
        />
      )}

      {/* Push-fix human gate: THE external side effect of the fix arc. The
          dialog names the branch + PR and warns it publishes the commits. */}
      {view.pushArmedFix !== null && (
        <ConfirmDialog
          title={`Push fix to PR #${view.pushArmedFix.prNumber}?`}
          confirmLabel={`Push to PR #${view.pushArmedFix.prNumber}`}
          busy={view.pushing}
          onConfirm={view.confirmPush}
          onCancel={view.cancelPush}
          message={
            <div className="flex flex-col gap-2">
              <span>
                Push the fix commit on{' '}
                <span className="font-mono text-foreground">
                  {view.pushArmedFix.branch}
                </span>{' '}
                to{' '}
                <span className="font-mono text-foreground">
                  PR #{view.pushArmedFix.prNumber}
                </span>
                ? This publishes the commits to the pull request on GitHub.
              </span>
              {view.pushError !== null && (
                <span
                  role="alert"
                  className="rounded-md border border-destructive/40 bg-destructive/[0.1] px-3 py-2 text-[12.5px] text-destructive"
                >
                  {view.pushError}
                </span>
              )}
            </div>
          }
        />
      )}
    </>
  );
}
