import {
  Button,
  EmptyState,
  FolderIcon,
  HistoryIcon,
  Menu,
  VerifiedIcon,
} from '@/components/ui';
import { ApplyConfirmDialog } from '../ApplyConfirmDialog';
import { ArtifactDetailPanel } from '../ArtifactDetailPanel';
import { CategoryTabs } from '../CategoryTabs';
import { ConventionDetailPanel } from '../ConventionDetailPanel';
import { ConventionGrid } from '../ConventionGrid';
import { HarnessProposalList } from '../HarnessProposalList';
import { ProfileBanner } from '../ProfileBanner';
import { RunControls } from '../RunControls';
import { useHarnessView } from './HarnessView.hooks';
import type { HarnessSection } from './HarnessView.hooks';
import type { HarnessViewProps } from './HarnessView.types';

/** One section-toggle tab: "Conventions" / "Proposed harness", with a live count. */
function SectionTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="tab"
      type="button"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
        active
          ? 'bg-primary/[0.12] text-primary'
          : 'text-muted-foreground hover:bg-white/[0.03] hover:text-foreground'
      }`}
    >
      {label}
      {count > 0 && (
        <span
          className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${
            active ? 'bg-primary/20 text-primary' : 'bg-white/[0.06] text-muted-foreground'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/** The Harness surface: run controls, the detected-profile banner, a section
 *  toggle between the tabbed convention grid and the proposed-harness panel, the
 *  slide-in detail sheets, and the apply-to-disk confirmation. */
export function HarnessView(props: HarnessViewProps) {
  const view = useHarnessView(props);

  if (!view.hasProject) {
    return (
      <EmptyState
        icon={<FolderIcon size={32} />}
        title="No active project"
        description="Open a project to audit its conventions. Harness runs over the active project's repo."
      />
    );
  }

  const setSection = (section: HarnessSection) => view.setSection(section);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <VerifiedIcon size={18} className="text-primary" />
        <div className="flex flex-col">
          <h1 className="text-[15px] font-semibold text-foreground">Harness</h1>
          <span className="text-[12px] text-muted-foreground">
            {view.projectName ?? 'Convention audit'}
          </span>
        </div>
        {view.hasHistory && (
          <div className="ml-auto">
            <Menu
              label="Run history"
              items={view.runHistory}
              align="right"
              trigger={
                <Button variant="ghost">
                  <HistoryIcon size={14} />
                  History
                </Button>
              }
            />
          </div>
        )}
      </div>

      <RunControls
        stream={view.stream}
        isStarting={view.isStarting}
        disabled={!view.hasProject}
        onScan={view.onScan}
        onCancel={view.onCancel}
      />

      {view.startError !== null && (
        <p className="border-b border-destructive/40 bg-destructive/[0.1] px-6 py-2 text-[12.5px] text-destructive">
          {view.startError}
        </p>
      )}

      <ProfileBanner profile={view.stream.profile} loading={view.profileLoading} />

      {/* Section toggle */}
      <div
        role="tablist"
        aria-label="Harness sections"
        className="flex items-center gap-1 border-b border-border px-6 py-2"
      >
        <SectionTab
          label="Conventions"
          count={view.conventionCount}
          active={view.section === 'conventions'}
          onClick={() => setSection('conventions')}
        />
        <SectionTab
          label="Proposed harness"
          count={view.proposalCount}
          active={view.section === 'proposals'}
          onClick={() => setSection('proposals')}
        />
      </div>

      {view.section === 'conventions' ? (
        <>
          <CategoryTabs
            tabs={view.tabs}
            active={view.activeTab}
            onSelect={view.setActiveTab}
          />
          <ConventionGrid
            findings={view.gridFindings}
            skeletonCount={view.skeletonCount}
            emptyMessage={view.emptyMessage}
            onOpen={view.openFinding}
          />
        </>
      ) : (
        <HarnessProposalList
          artifacts={view.artifacts}
          loading={view.proposalsLoading}
          emptyMessage={view.proposalsEmptyMessage}
          onOpen={view.openArtifact}
        />
      )}

      {view.selectedFinding !== null && (
        <ConventionDetailPanel
          finding={view.selectedFinding}
          pending={view.pending}
          onClose={view.closeFinding}
          onDismiss={view.onDismissFinding}
          onRestore={view.onRestoreFinding}
        />
      )}

      {view.selectedArtifact !== null && (
        <ArtifactDetailPanel
          artifact={view.selectedArtifact}
          pending={view.pending}
          onClose={view.closeArtifact}
          onApply={view.requestApply}
          onDismiss={view.onDismissArtifact}
          onRestore={view.onRestoreArtifact}
        />
      )}

      {view.applyTarget !== null && (
        <ApplyConfirmDialog
          artifact={view.applyTarget}
          applying={view.applying}
          error={view.applyError}
          onConfirm={view.confirmApply}
          onCancel={view.cancelApply}
        />
      )}
    </div>
  );
}
