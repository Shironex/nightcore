/** Hooks that resolve the permanent two-panel PR workspace into a single view
 *  model: the open-PR list, the per-PR run registry (concurrent runs across
 *  PRs), the selected PR's review-section slice, the finding selection, and the
 *  human-gated post-review state machine. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { MenuItem, RunProgressCategory } from '@/components/ui';
import { useToast } from '@/components/ui';
import {
  convertReviewFindingToTask,
  dismissReviewFinding,
  type EffortLevel,
  listOpenPrs,
  openExternal,
  postReviewToGithub,
  type PrFixState,
  type PrSummary,
  restoreReviewFinding,
  type ReviewInlineComment,
  type ReviewLens,
  type Task,
  viewerLogin,
} from '@/lib/bridge';
import { seedStepState } from '@/lib/scan-run';
import { useBulkConvert } from '@/lib/useBulkConvert';
import { usePreselectNavigation } from '@/lib/usePreselectNavigation';
import { useRunConfig } from '@/lib/useRunConfig';

import {
  ALL_LENSES,
  LENS_META,
  SEVERITY_META,
  SEVERITY_ORDER,
  severityRankValue,
} from '../prreview.constants';
import type { ReviewFindingView, ReviewVerdict } from '../prreview.types';
import { usePrFixes } from '../prreview-fixes.hooks';
import { findingCountForPr, runningPrNumbers } from '../prreview-runs';
import { usePrReviewRuns } from '../prreview-runs.hooks';
import { EMPTY_REVIEW_STREAM, type ReviewStream } from '../prreview-stream';
import type {
  ReviewSectionMode,
  ReviewSectionProps,
} from '../ReviewSection';
import type { PrReviewViewProps } from './PrReviewView.types';

/** The open-PR list state for the left rail. */
export interface OpenPrs {
  /** The active project's open pull requests, newest first. */
  prs: PrSummary[];
  /** True while the list is being (re)fetched. */
  loading: boolean;
  /** A fetch failure (gh missing / no remote / auth), or null. */
  error: string | null;
  /** Re-fetch the list. */
  refresh: () => void;
}

/**
 * Fetch the active project's open pull requests for the persistent left rail.
 * Fetches on mount / project arrival and on `refresh()` — the view is now a
 * permanent workspace, so freshness comes from the explicit Refresh-PRs action
 * rather than a per-screen remount. A gh failure becomes `error` (the picker
 * surfaces it inline) — the typed-number escape hatch still works, so a listing
 * failure never blocks starting a review.
 */
export function useOpenPrs(enabled: boolean): OpenPrs {
  const [prs, setPrs] = useState<PrSummary[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const list = await listOpenPrs();
        if (!cancelled) setPrs(list);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setPrs([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, reloadKey]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);
  return { prs, loading, error, refresh };
}

/** Order findings for display: open before resolved, then severity (high→low). */
function sortFindings(findings: ReviewFindingView[]): ReviewFindingView[] {
  const statusRank = (f: ReviewFindingView) => (f.status === 'open' ? 0 : 1);
  return [...findings].sort((a, b) => {
    const s = statusRank(a) - statusRank(b);
    if (s !== 0) return s;
    return severityRankValue(b.severity) - severityRankValue(a.severity);
  });
}

/** The one-line verdict framing prepended to the composed review body. */
const VERDICT_SUMMARY: Record<ReviewVerdict, string> = {
  approve: 'Approving — the changes look good. Notes below.',
  'request-changes':
    'Requesting changes — please address the findings below before merge.',
  comment: 'Review notes below.',
};

/** Compose the review body markdown from the SELECTED findings, grouped by
 *  severity. Nightcore's own trusted text — never raw foreign diff. */
export function composeReviewBody(
  verdict: ReviewVerdict,
  findings: ReviewFindingView[],
): string {
  const lines: string[] = ['## Nightcore PR Review', '', VERDICT_SUMMARY[verdict]];
  for (const severity of SEVERITY_ORDER) {
    const items = findings.filter((f) => f.severity === severity);
    if (items.length === 0) continue;
    lines.push('', `### ${SEVERITY_META[severity].label}`);
    for (const f of items) {
      const loc = f.line !== null ? `\`${f.file}:${f.line}\`` : `\`${f.file}\``;
      lines.push(`- ${loc} — **${f.title}** _(${LENS_META[f.lens].label})_`);
    }
  }
  lines.push('', '_Posted from Nightcore._');
  return lines.join('\n');
}

/** Inline comments for the SELECTED findings that carry a line anchor. The body is
 *  Nightcore-composed (title + finding body) — trusted text, never the raw diff. */
export function composeReviewComments(
  findings: ReviewFindingView[],
): ReviewInlineComment[] {
  return findings
    .filter((f) => f.line !== null)
    .map((f) => ({
      path: f.file,
      line: f.line as number,
      body: `${f.title}\n\n${f.body}`,
    }));
}

/** Everything the two-panel PrReviewView shell renders. `hasProject === false`
 *  is the only early-return branch; every other field is meaningful. */
export interface PrReviewViewModel {
  hasProject: boolean;
  projectName: string | null;
  // --- Left rail (persistent PR list) ---
  prs: PrSummary[];
  prsLoading: boolean;
  prsError: string | null;
  /** Re-fetch the open-PR list (the header Refresh-PRs action). */
  refreshPrs: () => void;
  /** The selected PR number, or null (empty right panel). */
  selectedPr: number | null;
  /** Select a PR. NEVER cancels anything — runs keep streaming in the registry. */
  selectPr: (prNumber: number | null) => void;
  /** PR numbers with a review currently in flight (list badges). */
  runningPrs: readonly number[];
  /** Open-finding count of each listed PR's latest completed run. */
  prFindingCounts: Readonly<Record<number, number>>;
  // --- Right panel (the selected PR's workspace) ---
  /** The selected PR's open-list summary, or null for a typed number. */
  selectedSummary: PrSummary | null;
  /** Open a PR page in the system browser (backend-validated https-only). */
  onOpenExternal: (url: string) => void;
  /** The fully-assembled review-section props, or null when nothing is selected. */
  review: ReviewSectionProps | null;
  // --- Finding detail overlay ---
  /** The finding open in the detail panel, or `null`. */
  selected: ReviewFindingView | null;
  closeFinding: () => void;
  /** True while a finding action (convert/dismiss/restore) is in flight. */
  pending: boolean;
  onConvert: (findingId: string) => void;
  onDismiss: (findingId: string) => void;
  onRestore: (findingId: string) => void;
  onGotoBoard?: () => void;
  // --- Post-review human gate ---
  /** The verdict whose ConfirmDialog is open, or `null`. */
  postVerdict: ReviewVerdict | null;
  posting: boolean;
  postError: string | null;
  /** The PR the armed post targets (the displayed run's PR). */
  postPrNumber: number | null;
  selectedCount: number;
  /** How many selected findings carry a line anchor (become inline comments). */
  selectedInlineCount: number;
  /** Confirm + await the post (composes body + comments from the selection). */
  confirmPost: () => void;
  /** Cancel the gate. A no-op while a post is in flight. */
  cancelPost: () => void;
  // --- Address-findings human gate (start a fix agent on the PR branch) ---
  /** True when the address ConfirmDialog is open. */
  addressArmed: boolean;
  /** True while the armed address is in flight (checkout + dispatch). */
  addressing: boolean;
  /** This PR's last address rejection (also shown in the toolbar), or null. */
  addressError: string | null;
  /** The PR the armed address targets (the displayed run's PR). */
  addressPrNumber: number | null;
  /** Selected OPEN findings count — the K the fix prompt will carry. */
  addressCount: number;
  /** Confirm + await the address (starts the paid fix session). */
  confirmAddress: () => void;
  /** Cancel the gate. A no-op while an address is in flight. */
  cancelAddress: () => void;
  // --- Push-fix human gate (THE external side effect of the fix arc) ---
  /** The fix the armed push targets (dialog open when non-null). */
  pushArmedFix: PrFixState | null;
  pushing: boolean;
  pushError: string | null;
  /** Confirm + await the push (plain push, never force). */
  confirmPush: () => void;
  /** Cancel the gate. A no-op while a push is in flight. */
  cancelPush: () => void;
}

/** Resolve the entire PR workspace into a single view model: the persistent
 *  left list + the selected PR's registry-driven right panel. The component
 *  shell renders purely from this. */
export function usePrReviewView({
  projectPath,
  projectName,
  onGotoBoard,
  preselect,
  onPreselectConsumed,
}: PrReviewViewProps): PrReviewViewModel {
  const hasProject = projectPath !== null;
  const toast = useToast();
  const runs = usePrReviewRuns(hasProject);
  const { registry, startErrors, start, cancel, selectRun, byPr, refreshRuns } = runs;
  const fixes = usePrFixes(hasProject);
  const openPrs = useOpenPrs(hasProject);
  // The lens/model/effort form state — lives above the section so it survives
  // PR switches and prefills on "New review".
  const config = useRunConfig<ReviewLens>(ALL_LENSES, !hasProject);

  const [selectedPr, setSelectedPr] = useState<number | null>(null);
  /** A history selection: display THIS run instead of the PR's latest. */
  const [viewingRunId, setViewingRunId] = useState<string | null>(null);
  /** "New review" over existing results: show config without dropping them. */
  const [reconfiguring, setReconfiguring] = useState(false);
  /** PRs inside the Review-click → optimistic-entry IPC gap (per-PR spinner). */
  const [startingPrs, setStartingPrs] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  /** The gh viewer login, fetched ONCE per mount. `null` = unknown → the
   *  own-PR guard fails open (all verdicts enabled). */
  const [login, setLogin] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // The findings checked for inclusion in the posted review.
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set());
  // Post-review human gate: the pending verdict (dialog open when non-null), the
  // in-flight flag (blocks double-fire + cancel), and the last error.
  const [postVerdict, setPostVerdict] = useState<ReviewVerdict | null>(null);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const postInFlight = useRef(false);
  // Address-findings human gate: the dialog flag, the in-flight flag (blocks
  // double-fire + cancel), and its ref twin (synchronous re-entrancy check).
  const [addressArmed, setAddressArmed] = useState(false);
  const [addressing, setAddressing] = useState(false);
  const addressInFlight = useRef(false);
  // Push-fix human gate: the armed fix id (dialog open when non-null), the
  // in-flight flag, and the last push error (kept-open dialog, like the post).
  const [pushFixId, setPushFixId] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const pushInFlight = useRef(false);

  // Project-switch reset, synchronously before paint (the render-adjust
  // pattern): the selection belongs to the previous project's PR numbers.
  const [lastProject, setLastProject] = useState(projectPath);
  if (lastProject !== projectPath) {
    setLastProject(projectPath);
    setSelectedPr(null);
    setViewingRunId(null);
    setReconfiguring(false);
    setSelectedId(null);
    setSelection(new Set());
    setPostVerdict(null);
    setPostError(null);
    setAddressArmed(false);
    setPushFixId(null);
    setPushError(null);
  }

  // The viewer login, once per mount. A rejection leaves `null` — fail-open.
  useEffect(() => {
    let cancelled = false;
    viewerLogin().then(
      (l) => {
        // Coerce a void resolution (mock/browser seams) to the null sentinel.
        if (!cancelled) setLogin(l ?? null);
      },
      (err: unknown) => console.error('viewer_login failed (guard fails open)', err),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Registry projections for the selected PR --------------------------
  const prView = selectedPr !== null ? byPr(selectedPr) : null;
  const latestStream = prView?.stream ?? null;
  const viewedStream =
    viewingRunId !== null ? (registry.get(viewingRunId)?.stream ?? null) : null;
  /** The stream the right panel displays: a history selection wins, else the
   *  PR's latest (running-first) stream. */
  const displayStream = viewedStream ?? latestStream;
  const displayRunId = displayStream?.runId ?? null;
  const viewingPastRun =
    viewingRunId !== null &&
    displayStream !== null &&
    latestStream !== null &&
    displayStream.runId !== latestStream.runId;

  const isStarting = selectedPr !== null && startingPrs.has(selectedPr);
  const startError =
    selectedPr !== null ? (startErrors.get(selectedPr) ?? null) : null;

  const mode: ReviewSectionMode =
    isStarting || displayStream?.status === 'running'
      ? 'running'
      : reconfiguring || displayStream === null
        ? 'config'
        : 'results';

  // The stream the RUNNING branch renders: the live run, or a seeded synthetic
  // one during the Review-click → optimistic-entry IPC gap (so the progress
  // rows lay out immediately, exactly like the old running screen's seed).
  const runningStream: ReviewStream | null = useMemo(() => {
    if (displayStream !== null && displayStream.status === 'running') {
      return displayStream;
    }
    if (!isStarting) return null;
    return {
      ...EMPTY_REVIEW_STREAM,
      status: 'running',
      prNumber: selectedPr,
      model: config.model,
      requestedLenses: config.orderedSelected,
      lensState: seedStepState(config.orderedSelected),
    };
  }, [displayStream, isStarting, selectedPr, config.model, config.orderedSelected]);

  const runningPrs = useMemo(() => runningPrNumbers(registry), [registry]);

  const prFindingCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const pr of openPrs.prs) {
      counts[pr.number] = findingCountForPr(registry, pr.number);
    }
    return counts;
  }, [openPrs.prs, registry]);

  const selectedSummary = useMemo(
    () =>
      selectedPr !== null
        ? (openPrs.prs.find((pr) => pr.number === selectedPr) ?? null)
        : null,
    [openPrs.prs, selectedPr],
  );
  const ownPr =
    login !== null && selectedSummary !== null && selectedSummary.author === login;

  const gridFindings = useMemo(
    () => sortFindings(displayStream?.findings ?? []),
    [displayStream?.findings],
  );

  const selected = useMemo(
    () => displayStream?.findings.find((f) => f.id === selectedId) ?? null,
    [displayStream?.findings, selectedId],
  );

  const progressCategories: RunProgressCategory[] = useMemo(
    () =>
      (runningStream?.requestedLenses ?? []).map((l) => ({
        key: l,
        label: LENS_META[l].label,
        icon: LENS_META[l].icon,
      })),
    [runningStream?.requestedLenses],
  );

  const lensFindingCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of runningStream?.findings ?? []) {
      counts[f.lens] = (counts[f.lens] ?? 0) + 1;
    }
    return counts;
  }, [runningStream?.findings]);

  const emptyMessage = useMemo(() => {
    if (displayStream === null) {
      return 'Review this pull request to surface findings across the review lenses.';
    }
    if (displayStream.status === 'running') return 'Reviewing…';
    if (displayStream.status === 'failed') {
      if (displayStream.failureReason === 'aborted') return 'Review cancelled.';
      return `Review failed${
        displayStream.error !== null ? `: ${displayStream.error}` : ''
      }.`;
    }
    return 'No findings — the diff looks clean across the selected lenses.';
  }, [displayStream]);

  // --- Finding lifecycle actions (against the DISPLAYED run) -------------
  // Bulk convert-all progress + loop (shared with the Insight sibling). The
  // convert closure is read through a ref inside, so rebinding on the displayed
  // run is safe.
  const convertFinding = useCallback(
    async (findingId: string): Promise<Task | null> => {
      if (displayRunId === null) return null;
      const task = await convertReviewFindingToTask(displayRunId, findingId);
      // The `pr-review-finding-converted` event folds the registry too; the
      // explicit persisted reconcile makes the mark deterministic.
      await selectRun(displayRunId);
      void refreshRuns();
      return task;
    },
    [displayRunId, selectRun, refreshRuns],
  );
  const {
    resetBulk,
    convertAll,
    bulkConverting,
    bulkProgress,
    bulkStatusMessage,
    bulkError,
  } = useBulkConvert(convertFinding, 'convertReviewFindingToTask failed');

  /** Drop the per-run finding UI (detail panel, post selection, bulk counters)
   *  — applied when the displayed run changes (PR switch, history, new run). */
  const resetFindingUi = useCallback(() => {
    setSelectedId(null);
    setSelection(new Set());
    resetBulk();
  }, [resetBulk]);

  const runAction = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      setPending(true);
      try {
        await fn();
      } catch (err) {
        console.error(`${label} finding failed`, err);
        toast.error(`Could not ${label} finding`, err);
      } finally {
        setPending(false);
      }
    },
    [toast],
  );

  const dismiss = useCallback(
    async (findingId: string) => {
      if (displayRunId === null) return;
      await dismissReviewFinding(displayRunId, findingId);
      await selectRun(displayRunId);
      void refreshRuns();
    },
    [displayRunId, selectRun, refreshRuns],
  );

  const restore = useCallback(
    async (findingId: string) => {
      if (displayRunId === null) return;
      await restoreReviewFinding(displayRunId, findingId);
      await selectRun(displayRunId);
      void refreshRuns();
    },
    [displayRunId, selectRun, refreshRuns],
  );

  const onToggleSelect = useCallback((findingId: string) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(findingId)) next.delete(findingId);
      else next.add(findingId);
      return next;
    });
  }, []);

  // Dismiss also deselects — a dismissed finding must not be posted. The
  // deselect is optimistic: a FAILED dismiss restores the selection (the
  // finding is still open and postable, so silently dropping it would shrink
  // the composed review with no signal beyond the toast).
  const onDismiss = useCallback(
    (id: string) => {
      const wasSelected = selection.has(id);
      if (wasSelected) {
        setSelection((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
      void runAction('dismiss', async () => {
        try {
          await dismiss(id);
        } catch (err) {
          if (wasSelected) {
            setSelection((prev) => {
              if (prev.has(id)) return prev;
              const next = new Set(prev);
              next.add(id);
              return next;
            });
          }
          throw err;
        }
      });
    },
    [selection, runAction, dismiss],
  );

  // --- Selection + post gate ---------------------------------------------
  const selectedFindings = useMemo(
    () =>
      (displayStream?.findings ?? []).filter(
        (f) => selection.has(f.id) && f.status !== 'dismissed',
      ),
    [displayStream?.findings, selection],
  );
  const selectedCount = selectedFindings.length;
  const selectedInlineCount = useMemo(
    () => selectedFindings.filter((f) => f.line !== null).length,
    [selectedFindings],
  );
  const canPost =
    displayStream?.status === 'completed' &&
    displayStream.prNumber !== null &&
    selectedCount > 0;

  const requestPost = useCallback((verdict: ReviewVerdict) => {
    setPostError(null);
    setPostVerdict(verdict);
  }, []);

  const cancelPost = useCallback(() => {
    // Inert while a post is in flight (the dialog's Cancel is disabled too).
    if (postInFlight.current) return;
    setPostVerdict(null);
    setPostError(null);
  }, []);

  const postPrNumber = displayStream?.prNumber ?? null;

  const confirmPost = useCallback(() => {
    if (postVerdict === null || postInFlight.current) return;
    if (postPrNumber === null || selectedFindings.length === 0) return;
    const verdict = postVerdict;
    const prNumber = postPrNumber;
    const body = composeReviewBody(verdict, selectedFindings);
    const comments = composeReviewComments(selectedFindings);
    postInFlight.current = true;
    setPosting(true);
    setPostError(null);
    void (async () => {
      try {
        await postReviewToGithub(prNumber, verdict, body, comments);
        toast.push({ tone: 'success', title: `Review posted to PR #${prNumber}` });
        setPostVerdict(null);
        setSelection(new Set());
      } catch (err) {
        // Surface BOTH inline (kept dialog) and via toast (the useToast
        // discipline), and keep the verdict open so the user can retry/cancel.
        console.error('postReviewToGithub failed', err);
        setPostError(err instanceof Error ? err.message : String(err));
        toast.error('Could not post the review', err);
      } finally {
        setPosting(false);
        postInFlight.current = false;
      }
    })();
  }, [postVerdict, postPrNumber, selectedFindings, toast]);

  // --- Address-findings gate + fix lifecycle (per-PR fix registry) ---------
  /** The selected PR's displayed fix (latest by `updatedAt`), or null. */
  const prFix = selectedPr !== null ? fixes.fixForPr(selectedPr) : null;
  const fixRunning = prFix !== null && prFix.status === 'running';
  /** Only OPEN selected findings feed the fix prompt (converted stay postable
   *  but are already tracked as tasks; dismissed never make the selection). */
  const selectedOpenFindings = useMemo(
    () => selectedFindings.filter((f) => f.status === 'open'),
    [selectedFindings],
  );
  const addressCount = selectedOpenFindings.length;
  const addressPrNumber = displayStream?.prNumber ?? selectedPr;
  // Own-PR is deliberately NOT guarded: fixing your own PR is the normal case.
  const canAddress =
    displayStream?.status === 'completed' &&
    displayRunId !== null &&
    addressCount > 0 &&
    !fixRunning;
  const addressError =
    selectedPr !== null ? (fixes.fixErrors.get(selectedPr) ?? null) : null;

  const requestAddress = useCallback(() => setAddressArmed(true), []);

  const cancelAddress = useCallback(() => {
    // Inert while an address is in flight (the dialog's Cancel is disabled too).
    if (addressInFlight.current) return;
    setAddressArmed(false);
  }, []);

  const confirmAddress = useCallback(() => {
    if (addressInFlight.current) return;
    const prNumber = addressPrNumber;
    const runId = displayRunId;
    const findingIds = selectedOpenFindings.map((f) => f.id);
    if (prNumber === null || runId === null || findingIds.length === 0) return;
    addressInFlight.current = true;
    setAddressing(true);
    void (async () => {
      try {
        const { fixId, error } = await fixes.address(prNumber, runId, findingIds);
        // Success closes the gate (the running strip takes over via nc:pr-fix).
        // A rejection keeps the dialog open — the per-PR fix error renders
        // inline there — AND toasts (the post/push failure discipline). A
        // guarded-out null (no error) stays silent.
        if (fixId !== null) setAddressArmed(false);
        else if (error !== null) toast.error('Could not start the fix agent', error);
      } finally {
        setAddressing(false);
        addressInFlight.current = false;
      }
    })();
  }, [addressPrNumber, displayRunId, selectedOpenFindings, fixes, toast]);

  const pushArmedFix =
    pushFixId !== null ? (fixes.fixes.get(pushFixId) ?? null) : null;

  const cancelPush = useCallback(() => {
    // Inert while a push is in flight (the dialog's Cancel is disabled too).
    if (pushInFlight.current) return;
    setPushFixId(null);
    setPushError(null);
  }, []);

  const confirmPush = useCallback(() => {
    if (pushFixId === null || pushInFlight.current) return;
    const fixId = pushFixId;
    pushInFlight.current = true;
    setPushing(true);
    setPushError(null);
    void (async () => {
      try {
        await fixes.push(fixId);
        toast.push({ tone: 'success', title: 'Fix pushed to the PR branch' });
        setPushFixId(null);
      } catch (err) {
        // Surface BOTH inline (kept dialog) and via toast (the useToast
        // discipline), and keep the gate open so the user can retry/cancel.
        console.error('push_pr_fix failed', err);
        setPushError(err instanceof Error ? err.message : String(err));
        toast.error('Could not push the fix', err);
      } finally {
        setPushing(false);
        pushInFlight.current = false;
      }
    })();
  }, [pushFixId, fixes, toast]);

  // --- Navigation + run actions ------------------------------------------
  const selectPr = useCallback(
    (prNumber: number | null) => {
      // Selection ONLY: any in-flight run keeps streaming in the registry and
      // shows as a badge in the list (and every fix keeps its per-PR state).
      setSelectedPr(prNumber);
      setViewingRunId(null);
      setReconfiguring(false);
      resetFindingUi();
      // Close ALL the human gates — they were armed against the previous PR's
      // selection/fix (a programmatic switch, e.g. preselect, can land while
      // a dialog is open). The post gate especially must not survive: its
      // verdict would target the NEW PR's displayed run.
      setPostVerdict(null);
      setPostError(null);
      setAddressArmed(false);
      setPushFixId(null);
      setPushError(null);
    },
    [resetFindingUi],
  );

  const viewRun = useCallback(
    (runId: string) => {
      resetFindingUi();
      setReconfiguring(false);
      setViewingRunId(runId);
      // Authoritative reload of the persisted run into the registry.
      void selectRun(runId);
    },
    [resetFindingUi, selectRun],
  );

  const backToLatest = useCallback(() => {
    resetFindingUi();
    setViewingRunId(null);
    setReconfiguring(false);
  }, [resetFindingUi]);

  // Plain per-render projection (MenuItem construction is trivial; the history
  // array itself is already a fresh filter per render inside `byPr`).
  const historyItems: MenuItem[] = (prView?.history ?? []).map((run) => ({
    label: `${new Date(run.createdAt).toLocaleString()} · ${run.findings.length} ${
      run.findings.length === 1 ? 'finding' : 'findings'
    }`,
    onClick: () => viewRun(run.id),
  }));

  // The latest selected PR, readable inside async continuations (a state read
  // there can be a render behind).
  const selectedPrRef = useRef(selectedPr);
  selectedPrRef.current = selectedPr;

  const onReview = useCallback(() => {
    const prNumber = selectedPrRef.current;
    if (prNumber === null) return;
    resetFindingUi();
    setStartingPrs((prev) => new Set(prev).add(prNumber));
    void (async () => {
      try {
        const runId = await start(prNumber, config.orderedSelected, {
          model: config.model,
          effort: config.effort as EffortLevel | null,
        });
        // Leave config only once the run actually starts — a rejected start
        // lands in the per-PR startErrors and config STAYS up so the banner is
        // seen. Skip the flag clears when the user already switched PRs
        // (selectPr reset them; clearing again could collapse the OTHER PR's
        // freshly opened config).
        if (runId !== null && selectedPrRef.current === prNumber) {
          setReconfiguring(false);
          setViewingRunId(null);
        }
      } finally {
        setStartingPrs((prev) => {
          const next = new Set(prev);
          next.delete(prNumber);
          return next;
        });
      }
    })();
  }, [resetFindingUi, start, config.orderedSelected, config.model, config.effort]);

  const runningRunId =
    displayStream !== null && displayStream.status === 'running'
      ? displayStream.runId
      : null;
  const onCancelRun = useCallback(() => {
    if (runningRunId === null) return;
    void cancel(runningRunId).catch((err: unknown) => {
      console.error('cancel_pr_review failed', err);
      toast.error('Could not cancel the review', err);
    });
  }, [runningRunId, cancel, toast]);

  // Plain closure (config is a fresh object each render, so memoizing over it
  // buys nothing): "New review" re-opens config prefilled from the displayed run.
  const startNewReview = () => {
    config.prefill({
      model: displayStream?.model,
      categories: displayStream?.requestedLenses,
    });
    resetFindingUi();
    setReconfiguring(true);
  };

  // Board→scan provenance navigation: a task's `sourceRef` chip landed here
  // with a run + finding to open. Consume the target FIRST, select the run's
  // PR, project that run's stream, and open the finding's detail panel.
  const preselectRun = useCallback(
    async (runId: string) => {
      const stream = await selectRun(runId);
      if (stream !== null && stream.prNumber !== null) {
        setSelectedPr(stream.prNumber);
        setViewingRunId(runId);
      }
    },
    [selectRun],
  );
  usePreselectNavigation({
    preselect,
    onPreselectConsumed,
    selectRun: preselectRun,
    onEnter: () => {
      setReconfiguring(false);
      resetFindingUi();
      // Close ALL the human gates, exactly like a manual selectPr — a
      // preselect can land while any of the three dialogs is open against a
      // different PR's run/fix, and this path bypasses selectPr entirely.
      setPostVerdict(null);
      setPostError(null);
      setAddressArmed(false);
      setPushFixId(null);
      setPushError(null);
    },
    onOpenItem: (target) => setSelectedId(target.itemId),
  });

  // --- The assembled review-section slice ---------------------------------
  const review: ReviewSectionProps | null =
    selectedPr === null
      ? null
      : {
          prNumber: selectedPr,
          mode,
          stream: mode === 'running' ? runningStream : displayStream,
          configure: {
            config,
            isStarting,
            startError,
            onReview,
            onBackToResults:
              reconfiguring && displayStream !== null
                ? () => setReconfiguring(false)
                : null,
          },
          running: {
            categories: progressCategories,
            findingCounts: lensFindingCounts,
            onCancel: onCancelRun,
          },
          results: {
            gridFindings,
            emptyMessage,
            selection,
            onToggleSelect,
            onOpenFinding: (finding) => setSelectedId(finding.id),
            onNewReview: startNewReview,
            toolbar: {
              openCount: (displayStream?.findings ?? []).filter(
                (f) => f.status === 'open',
              ).length,
              onConvertAll: () =>
                convertAll(
                  (displayStream?.findings ?? []).filter((f) => f.status === 'open'),
                ),
              bulkConverting,
              bulkProgress,
              bulkStatusMessage,
              bulkError,
              selectedCount,
              canPost,
              requestPost,
              ownPr,
              addressCount,
              canAddress,
              fixRunning,
              requestAddress,
              addressError,
            },
            // The PR's fix strip: plain closures over `prFix` (fresh per render;
            // the card is inert chrome, so memoizing buys nothing). The push
            // button ARMS the gate — the actual push lives behind confirmPush.
            fix:
              prFix === null
                ? null
                : {
                    fix: prFix,
                    pushing: pushing && pushFixId === prFix.id,
                    onCancel: () => {
                      void fixes.cancel(prFix.id).catch((err: unknown) => {
                        console.error('cancel_pr_fix failed', err);
                        toast.error('Could not cancel the fix', err);
                      });
                    },
                    onRequestPush: () => {
                      setPushError(null);
                      setPushFixId(prFix.id);
                    },
                    // Fresh review of the same PR with the last config (the
                    // lifted RunConfig survives runs and PR switches).
                    onReReview: onReview,
                    onDismiss: () => fixes.dismiss(prFix.id),
                  },
          },
          history: {
            items: historyItems,
            viewingPastRun,
            onBackToLatest: backToLatest,
          },
        };

  return {
    hasProject,
    projectName,
    prs: openPrs.prs,
    prsLoading: openPrs.loading,
    prsError: openPrs.error,
    refreshPrs: openPrs.refresh,
    selectedPr,
    selectPr,
    runningPrs,
    prFindingCounts,
    selectedSummary,
    onOpenExternal: (url: string) =>
      void openExternal(url).catch((err: unknown) => {
        console.error('open_external failed', err);
        toast.error('Could not open the pull request', err);
      }),
    review,
    selected,
    closeFinding: () => setSelectedId(null),
    pending,
    onConvert: (id) => void runAction('convert', () => convertFinding(id)),
    onDismiss,
    onRestore: (id) => void runAction('restore', () => restore(id)),
    onGotoBoard,
    postVerdict,
    posting,
    postError,
    postPrNumber,
    selectedCount,
    selectedInlineCount,
    confirmPost,
    cancelPost,
    addressArmed,
    addressing,
    addressError,
    addressPrNumber,
    addressCount,
    confirmAddress,
    cancelAddress,
    pushArmedFix,
    pushing,
    pushError,
    confirmPush,
    cancelPush,
  };
}
