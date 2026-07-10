/** The Harness task-shaped proposals concern — split out of the HarnessView
 *  mega-hook: the proposal detail selection, the convert-all loop, and the
 *  bundle-apply confirm flow (writing every referenced artifact to disk). */
import { useCallback, useMemo, useState } from 'react';

import type { BulkConvertBarProps, ToastApi } from '@/components/ui';
import { useBulkConvert } from '@/lib/useBulkConvert';

import type { HarnessProposalVM } from './harness.types';
import type { UseHarnessResult } from './harness-data.hooks';
import type { HarnessStream } from './harness-stream';

/** What the proposals concern reads (threaded by the view-model composition). */
export interface HarnessProposalsConfig {
  stream: HarnessStream;
  harness: UseHarnessResult;
  /** Run one item action behind `pending` with a labeled failure toast. */
  runAction: (label: string, fn: () => Promise<unknown>) => Promise<void>;
  toast: ToastApi;
}

/** The proposals slice the HarnessView shell renders. */
export interface HarnessProposalsApi {
  proposals: HarnessProposalVM[];
  proposalsLoading: boolean;
  proposalsEmptyMessage: string;
  selectedProposal: HarnessProposalVM | null;
  openProposal: (proposal: HarnessProposalVM) => void;
  /** Open a proposal by id (the preselect provenance target). */
  openProposalById: (id: string) => void;
  closeProposal: () => void;
  onConvertProposal: (proposalId: string) => void;
  onDismissProposal: (proposalId: string) => void;
  onRestoreProposal: (proposalId: string) => void;
  /** The convert-all bar slice (every still-convertible proposal → tasks), the
   *  shared Insight idiom: progress, partial-failure resilience, aria-live. The
   *  `count` doubles as the section-tab badge (still-convertible proposals). */
  proposalsBulk: BulkConvertBarProps;
  /** Reset the convert-all counters so a prior run's summary can't bleed on a run change. */
  resetProposalsBulk: () => void;
  onApplyProposal: (proposalId: string) => void;
  applyProposalTarget: HarnessProposalVM | null;
  applyProposalPaths: string[];
  confirmApplyProposal: () => void;
  cancelApplyProposal: () => void;
}

/** Own the proposals detail selection + convert-all + bundle-apply confirm. */
export function useHarnessProposals({
  stream,
  harness,
  runAction,
  toast,
}: HarnessProposalsConfig): HarnessProposalsApi {
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [applyProposalTargetId, setApplyProposalTargetId] = useState<string | null>(
    null,
  );

  const selectedProposal = useMemo(
    () => stream.proposals.find((p) => p.id === selectedProposalId) ?? null,
    [stream.proposals, selectedProposalId],
  );
  const applyProposalTarget = useMemo(
    () => stream.proposals.find((p) => p.id === applyProposalTargetId) ?? null,
    [stream.proposals, applyProposalTargetId],
  );
  // The repo-relative paths the bundle would write (resolved from the referenced
  // artifacts), shown verbatim in the confirm dialog so the user sees exactly what lands.
  const applyProposalPaths = useMemo(() => {
    if (applyProposalTarget === null) return [];
    return applyProposalTarget.artifactIds
      .map((id) => stream.artifacts.find((a) => a.id === id)?.targetPath)
      .filter((p): p is string => typeof p === 'string');
  }, [applyProposalTarget, stream.artifacts]);

  const proposalsEmptyMessage = useMemo(() => {
    if (stream.status === 'idle') {
      return 'Run a scan to synthesize task-shaped proposals from your conventions.';
    }
    if (stream.status === 'failed') {
      return `Scan failed${stream.error !== null ? `: ${stream.error}` : ''}.`;
    }
    return 'No proposals synthesized for this scan.';
  }, [stream.status, stream.error]);

  // Bundle-apply confirmation: writing every referenced artifact to disk is a
  // consequential action, so it goes through a confirm dialog (like arm-check). On
  // confirm, `runAction` surfaces any partial-failure/agent-task error as a toast.
  const confirmApplyProposal = useCallback(() => {
    if (applyProposalTargetId === null) return;
    const id = applyProposalTargetId;
    const count = applyProposalPaths.length;
    setApplyProposalTargetId(null);
    void runAction('apply proposal bundle', async () => {
      await harness.applyProposal(id);
      toast.push({
        tone: 'success',
        title: 'Proposal applied',
        description: `${count} ${count === 1 ? 'artifact' : 'artifacts'} written to disk.`,
      });
    });
  }, [applyProposalTargetId, applyProposalPaths.length, runAction, harness, toast]);

  const cancelApplyProposal = useCallback(() => setApplyProposalTargetId(null), []);

  // Convert every still-convertible proposal (status `proposed`) in one action —
  // the shared Insight convert-all machine (sequential loop, per-item progress,
  // partial-failure resilience, aria-live). The `proposal-converted` notice keeps
  // the stream in sync as each lands; the convert closure is read through a ref so
  // its rebinding on `stream.runId` is safe.
  const convertibleProposals = useMemo(
    () => stream.proposals.filter((p) => p.status === 'proposed'),
    [stream.proposals],
  );
  const {
    resetBulk,
    convertAll,
    bulkConverting,
    bulkProgress,
    bulkStatusMessage,
    bulkError,
  } = useBulkConvert(harness.convertProposal, 'convertHarnessProposal failed');

  return {
    proposals: stream.proposals,
    proposalsLoading: stream.status === 'running' && stream.proposals.length === 0,
    proposalsEmptyMessage,
    selectedProposal,
    openProposal: (proposal) => setSelectedProposalId(proposal.id),
    openProposalById: (id) => setSelectedProposalId(id),
    closeProposal: () => setSelectedProposalId(null),
    onConvertProposal: (id) =>
      void runAction('convert proposal', () => harness.convertProposal(id)),
    onDismissProposal: (id) =>
      void runAction('dismiss proposal', () => harness.dismissProposal(id)),
    onRestoreProposal: (id) =>
      void runAction('restore proposal', () => harness.restoreProposal(id)),
    proposalsBulk: {
      count: convertibleProposals.length,
      converting: bulkConverting,
      progress: bulkProgress,
      statusMessage: bulkStatusMessage,
      error: bulkError,
      onConvertAll: () => convertAll(convertibleProposals),
    },
    resetProposalsBulk: resetBulk,
    onApplyProposal: (id) => setApplyProposalTargetId(id),
    applyProposalTarget,
    applyProposalPaths,
    confirmApplyProposal,
    cancelApplyProposal,
  };
}
