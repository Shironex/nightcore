/** The Harness task-shaped proposals concern — split out of the HarnessView
 *  mega-hook: the proposal detail selection, the convert-all loop, and the
 *  bundle-apply confirm flow (writing every referenced artifact to disk). */
import { useCallback, useMemo, useState } from 'react';

import type { ToastApi } from '@/components/ui';

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
  proposalCount: number;
  proposalsLoading: boolean;
  proposalsEmptyMessage: string;
  selectedProposal: HarnessProposalVM | null;
  openProposal: (proposal: HarnessProposalVM) => void;
  /** Open a proposal by id (the preselect provenance target). */
  openProposalById: (id: string) => void;
  closeProposal: () => void;
  hasConvertibleProposals: boolean;
  onConvertProposal: (proposalId: string) => void;
  onDismissProposal: (proposalId: string) => void;
  onRestoreProposal: (proposalId: string) => void;
  onConvertAllProposals: () => void;
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

  // Convert every still-convertible proposal (status `proposed`) in one action, mirroring
  // Insight's convert-all. Sequential so a mid-flight failure surfaces without racing the
  // store; the `proposal-converted` notice keeps the stream in sync as each lands.
  const convertibleProposals = useMemo(
    () => stream.proposals.filter((p) => p.status === 'proposed'),
    [stream.proposals],
  );
  const onConvertAllProposals = useCallback(() => {
    if (convertibleProposals.length === 0) return;
    void runAction('convert all proposals', async () => {
      for (const p of convertibleProposals) {
        await harness.convertProposal(p.id);
      }
      toast.push({
        tone: 'success',
        title: 'Proposals converted',
        description: `${convertibleProposals.length} ${
          convertibleProposals.length === 1 ? 'proposal' : 'proposals'
        } converted to board tasks.`,
      });
    });
  }, [convertibleProposals, runAction, harness, toast]);

  return {
    proposals: stream.proposals,
    proposalCount: stream.proposals.filter((p) => p.status === 'proposed').length,
    proposalsLoading: stream.status === 'running' && stream.proposals.length === 0,
    proposalsEmptyMessage,
    selectedProposal,
    openProposal: (proposal) => setSelectedProposalId(proposal.id),
    openProposalById: (id) => setSelectedProposalId(id),
    closeProposal: () => setSelectedProposalId(null),
    hasConvertibleProposals: convertibleProposals.length > 0,
    onConvertProposal: (id) =>
      void runAction('convert proposal', () => harness.convertProposal(id)),
    onDismissProposal: (id) =>
      void runAction('dismiss proposal', () => harness.dismissProposal(id)),
    onRestoreProposal: (id) =>
      void runAction('restore proposal', () => harness.restoreProposal(id)),
    onConvertAllProposals,
    onApplyProposal: (id) => setApplyProposalTargetId(id),
    applyProposalTarget,
    applyProposalPaths,
    confirmApplyProposal,
    cancelApplyProposal,
  };
}
