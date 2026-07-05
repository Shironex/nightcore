/** Hooks that resolve the Issue Triage surface into a single view model: the issue
 *  list + selection + detail fetch, the model/effort config, the shared validation
 *  run-lifecycle (via `useScanRun`), and the two human-gated action dialogs. */
import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useToast } from '@/components/ui';
import {
  cancelIssueValidation,
  convertIssueValidationToTask,
  type EffortLevel,
  fetchProjectIssueDetail,
  getIssueValidation,
  type IssueDetail,
  type IssueSummary,
  type IssueTriageEvent,
  type IssueValidationRun,
  listIssueValidations,
  listProjectIssues,
  onIssueTriageEvent,
  postIssueValidationComment,
  previewIssueComment,
  startIssueValidation,
  type Task,
} from '@/lib/bridge';
import { usePreselectNavigation } from '@/lib/usePreselectNavigation';
import { useScanRun } from '@/lib/useScanRun';

import {
  EMPTY_ISSUE_TRIAGE_STREAM,
  foldIssueTriage,
  type IssueTriageStream,
  streamFromRun,
} from '../issue-stream';
import {
  COMPLEXITY_META,
  COMPLEXITY_TO_EFFORT,
  suggestedTaskKind,
} from '../issue-triage.constants';
import type { IssueValidationBadge } from '../IssueList/IssueList.types';
import type { IssueTriageViewProps } from './IssueTriageView.types';

/** Coerce an unknown thrown value to a message string. */
function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The validation run-lifecycle for the single active/selected issue. */
interface UseIssueTriageResult {
  stream: IssueTriageStream;
  runs: IssueValidationRun[];
  isStarting: boolean;
  startError: string | null;
  activeRunId: MutableRefObject<string | null>;
  start: (
    issue: IssueSummary,
    detail: IssueDetail,
    model: string | null,
    effort: string | null,
  ) => Promise<void>;
  cancel: () => Promise<void>;
  selectRun: (runId: string) => Promise<void>;
  reset: () => void;
  refreshRuns: () => Promise<IssueValidationRun[]>;
  convert: (runId: string) => Promise<Task>;
}

/** Drive the validation lifecycle: live `issue-validation-*` fold for the active run,
 *  authoritative reconciliation on completion, single-flight start, cancel, and the
 *  convert side effect. Mirrors `useInsight`. */
function useIssueTriage(hasProject: boolean): UseIssueTriageResult {
  const scan = useScanRun<IssueTriageEvent, IssueValidationRun, IssueTriageStream>({
    emptyStream: EMPTY_ISSUE_TRIAGE_STREAM,
    listRuns: listIssueValidations,
    getRun: getIssueValidation,
    streamFromRun,
    cancelRun: cancelIssueValidation,
    subscribe: onIssueTriageEvent,
    onEvent: (event, { activeRunId, setStream, refreshRuns, reconcile }) => {
      if (event.type === 'issue-validation-converted') {
        setStream((prev) =>
          prev.runId === event.runId ? { ...prev, linkedTaskId: event.taskId } : prev,
        );
        void refreshRuns();
        return;
      }
      // Lifecycle events only apply to the run currently displayed/driven.
      if (event.runId !== activeRunId.current) return;
      setStream((prev) => foldIssueTriage(prev, event));
      if (event.type === 'issue-validation-completed' || event.type === 'issue-validation-failed') {
        void reconcile(event.runId);
      }
    },
  });
  const { setStream, runStart, refreshRuns, activeRunId } = scan;

  const start = useCallback(
    async (
      issue: IssueSummary,
      detail: IssueDetail,
      model: string | null,
      effort: string | null,
    ) => {
      await runStart(hasProject, async () => {
        const runId = await startIssueValidation(
          {
            issueNumber: issue.number,
            issueTitle: issue.title,
            issueBody: detail.body,
            issueAuthor: issue.author,
            labels: issue.labels,
            comments: detail.comments,
            linkedPrs: issue.linkedPrs,
          },
          { model, effort: effort as EffortLevel | null },
        );
        // Optimistic running state until `issue-validation-started` lands.
        return {
          runId,
          optimistic: {
            ...EMPTY_ISSUE_TRIAGE_STREAM,
            runId,
            issueNumber: issue.number,
            status: 'running',
            model,
          },
        };
      });
    },
    [hasProject, runStart],
  );

  const reset = useCallback(() => {
    activeRunId.current = null;
    setStream(EMPTY_ISSUE_TRIAGE_STREAM);
  }, [activeRunId, setStream]);

  const convert = useCallback(
    async (runId: string): Promise<Task> => {
      const task = await convertIssueValidationToTask(runId);
      setStream((prev) => (prev.runId === runId ? { ...prev, linkedTaskId: task.id } : prev));
      await refreshRuns();
      return task;
    },
    [setStream, refreshRuns],
  );

  return {
    stream: scan.stream,
    runs: scan.runs,
    isStarting: scan.isStarting,
    startError: scan.startError,
    activeRunId,
    start,
    cancel: scan.cancel,
    selectRun: scan.selectRun,
    reset,
    refreshRuns,
    convert,
  };
}

/** Filter issues (client-side) by number, title, labels, and author. */
function matchesFilter(issue: IssueSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  if (`#${issue.number}`.includes(q)) return true;
  if (issue.title.toLowerCase().includes(q)) return true;
  if (issue.author.toLowerCase().includes(q)) return true;
  return issue.labels.some((label) => label.toLowerCase().includes(q));
}

interface PostDialogState {
  open: boolean;
  body: string;
  loading: boolean;
  error: string | null;
  posting: boolean;
}

interface ConvertDialogState {
  open: boolean;
  converting: boolean;
  error: string | null;
}

/** Everything the IssueTriageView shell renders. `hasProject === false` is the only
 *  early-return branch; every other field is meaningful in the project view. */
export interface IssueTriageViewModel {
  hasProject: boolean;
  projectName: string | null;
  // Issue list
  issues: IssueSummary[];
  totalCount: number;
  issuesLoading: boolean;
  issuesError: string | null;
  filter: string;
  onFilterChange: (value: string) => void;
  selectedNumber: number | null;
  onSelectIssue: (issue: IssueSummary) => void;
  onRefreshIssues: () => void;
  badgeByNumber: Record<number, IssueValidationBadge>;
  // Detail
  selectedIssue: IssueSummary | null;
  detail: IssueDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  // Validation lifecycle for the selected issue
  panelStream: IssueTriageStream;
  model: string | null;
  effort: string | null;
  onChangeModel: (model: string | null) => void;
  onChangeEffort: (effort: string | null) => void;
  canValidate: boolean;
  running: boolean;
  hasVerdict: boolean;
  stale: boolean;
  startError: string | null;
  onValidate: () => void;
  onCancel: () => void;
  // Failure notice
  failed: boolean;
  failedIsCancel: boolean;
  failureMessage: string | null;
  // Actions
  onGotoBoard?: () => void;
  // Post dialog
  postDialog: PostDialogState;
  onOpenPostDialog: () => void;
  onClosePostDialog: () => void;
  onSubmitPost: () => void;
  // Convert dialog
  convertDialog: ConvertDialogState;
  suggestedKind: 'Build' | 'Decompose';
  complexityLabel: string | null;
  effortLabel: string | null;
  alreadyLinked: boolean;
  onOpenConvertDialog: () => void;
  onCloseConvertDialog: () => void;
  onSubmitConvert: () => void;
}

/** Resolve the entire Issue Triage surface into a single view model. */
export function useIssueTriageView({
  projectPath,
  projectName,
  onGotoBoard,
  preselect,
  onPreselectConsumed,
}: IssueTriageViewProps): IssueTriageViewModel {
  const hasProject = projectPath !== null;
  const toast = useToast();
  const triage = useIssueTriage(hasProject);
  const { selectRun, reset, convert } = triage;

  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [issuesError, setIssuesError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const [selectedIssue, setSelectedIssue] = useState<IssueSummary | null>(null);
  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<string | null>(null);

  const [postDialog, setPostDialog] = useState<PostDialogState>({
    open: false,
    body: '',
    loading: false,
    error: null,
    posting: false,
  });
  const [convertDialog, setConvertDialog] = useState<ConvertDialogState>({
    open: false,
    converting: false,
    error: null,
  });

  // Latest runs, read through a ref so `selectIssue` picks the right validation
  // without re-creating on every run-list change.
  const runsRef = useRef(triage.runs);
  runsRef.current = triage.runs;

  const loadIssues = useCallback(async () => {
    if (projectPath === null) {
      setIssues([]);
      return;
    }
    setIssuesLoading(true);
    setIssuesError(null);
    try {
      setIssues(await listProjectIssues());
    } catch (err) {
      setIssuesError(errMessage(err));
      setIssues([]);
    } finally {
      setIssuesLoading(false);
    }
  }, [projectPath]);

  // Load the issue list on mount / project change.
  useEffect(() => {
    void loadIssues();
  }, [loadIssues]);

  // Fetch one issue's detail (body + comments); shared by list-select + preselect.
  const loadDetail = useCallback(async (issueNumber: number) => {
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      setDetail(await fetchProjectIssueDetail(issueNumber));
    } catch (err) {
      setDetailError(errMessage(err));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const onSelectIssue = useCallback(
    (issue: IssueSummary) => {
      setSelectedIssue(issue);
      // Load the newest existing validation for this issue (runs are newest-first),
      // else reset the stream so the panel shows the validate controls.
      const existing = runsRef.current.find((r) => r.issueNumber === issue.number);
      if (existing !== undefined) void selectRun(existing.id);
      else reset();
      void loadDetail(issue.number);
    },
    [selectRun, reset, loadDetail],
  );

  // Board→triage provenance: a task's `sourceRef` (`issue-triage:<runId>`) navigated
  // here. Load that validation run + synthesize its issue header from the run so the
  // panel opens on the cached verdict even if the issue has since closed.
  const preselectRun = useCallback(
    async (runId: string) => {
      const run = await getIssueValidation(runId);
      await selectRun(runId);
      if (run === null) return;
      setSelectedIssue({
        number: run.issueNumber,
        title: run.issueTitle,
        state: 'open',
        labels: [],
        author: '',
        createdAt: '',
        updatedAt: '',
        commentCount: 0,
        linkedPrs: [],
      });
      void loadDetail(run.issueNumber);
    },
    [selectRun, loadDetail],
  );

  usePreselectNavigation({
    preselect,
    onPreselectConsumed,
    selectRun: preselectRun,
    onEnter: () => setFilter(''),
    onOpenItem: () => {},
  });

  // The stream folds only for the selected issue; guard on the issue number so a
  // stale stream from a just-deselected issue never leaks into the panel.
  const selectedNumber = selectedIssue?.number ?? null;
  const streamMatches =
    selectedNumber !== null && triage.stream.issueNumber === selectedNumber;
  const panelStream = streamMatches ? triage.stream : EMPTY_ISSUE_TRIAGE_STREAM;
  const running = triage.isStarting || (streamMatches && panelStream.status === 'running');
  const hasVerdict = streamMatches && panelStream.result !== null;
  const failed = streamMatches && panelStream.status === 'failed';
  const canValidate = hasProject && detail !== null && !running;

  const stale = useMemo(() => {
    if (!hasVerdict || selectedIssue === null || panelStream.validatedAt === null) return false;
    // Both sides are epoch ms: GitHub's ISO `updatedAt` parsed vs the run's
    // `updated_at` (Rust stores epoch ms). Stale when the issue moved since validation.
    const updated = Date.parse(selectedIssue.updatedAt);
    return !Number.isNaN(updated) && updated > panelStream.validatedAt;
  }, [hasVerdict, selectedIssue, panelStream.validatedAt]);

  const filteredIssues = useMemo(
    () => issues.filter((issue) => matchesFilter(issue, filter)),
    [issues, filter],
  );

  const badgeByNumber = useMemo(() => {
    const map: Record<number, IssueValidationBadge> = {};
    const issueByNumber = new Map(issues.map((i) => [i.number, i]));
    const seen = new Set<number>();
    for (const run of triage.runs) {
      // Runs are newest-first; the first per issue is the current one.
      if (seen.has(run.issueNumber)) continue;
      seen.add(run.issueNumber);
      if (run.status !== 'completed') continue;
      const issue = issueByNumber.get(run.issueNumber);
      // Epoch-ms comparison (see `stale` above): GitHub ISO `updatedAt` vs the run's
      // epoch-ms `updated_at`.
      const isStale = issue !== undefined && Date.parse(issue.updatedAt) > run.updatedAt;
      map[run.issueNumber] = isStale ? 'stale' : 'validated';
    }
    return map;
  }, [triage.runs, issues]);

  // --- Actions -------------------------------------------------------------

  const onValidate = useCallback(() => {
    if (selectedIssue === null || detail === null) return;
    void triage.start(selectedIssue, detail, model, effort);
  }, [selectedIssue, detail, triage, model, effort]);

  const runId = panelStream.runId;

  const onOpenPostDialog = useCallback(async () => {
    if (runId === null || panelStream.result === null) return;
    setPostDialog({ open: true, body: '', loading: true, error: null, posting: false });
    try {
      const body = await previewIssueComment(runId);
      setPostDialog((p) => ({ ...p, body, loading: false }));
    } catch (err) {
      setPostDialog((p) => ({ ...p, loading: false, error: errMessage(err) }));
    }
  }, [runId, panelStream.result]);

  const onSubmitPost = useCallback(async () => {
    if (runId === null) return;
    setPostDialog((p) => ({ ...p, posting: true, error: null }));
    try {
      await postIssueValidationComment(runId);
      // Re-project the run so the panel picks up the `postedAt` marker.
      await selectRun(runId);
      setPostDialog((p) => ({ ...p, open: false, posting: false }));
      toast.push({ tone: 'success', title: 'Comment posted to GitHub' });
    } catch (err) {
      setPostDialog((p) => ({ ...p, posting: false, error: errMessage(err) }));
    }
  }, [runId, selectRun, toast]);

  const onSubmitConvert = useCallback(async () => {
    if (runId === null) return;
    setConvertDialog((c) => ({ ...c, converting: true, error: null }));
    try {
      await convert(runId);
      setConvertDialog((c) => ({ ...c, open: false, converting: false }));
      toast.push({ tone: 'success', title: 'Task created from the validation' });
    } catch (err) {
      setConvertDialog((c) => ({ ...c, converting: false, error: errMessage(err) }));
    }
  }, [runId, convert, toast]);

  const complexity = panelStream.result?.estimatedComplexity ?? null;

  return {
    hasProject,
    projectName,
    issues: filteredIssues,
    totalCount: issues.length,
    issuesLoading,
    issuesError,
    filter,
    onFilterChange: setFilter,
    selectedNumber,
    onSelectIssue,
    onRefreshIssues: () => void loadIssues(),
    badgeByNumber,
    selectedIssue,
    detail,
    detailLoading,
    detailError,
    panelStream,
    model,
    effort,
    onChangeModel: setModel,
    onChangeEffort: setEffort,
    canValidate,
    running,
    hasVerdict,
    stale,
    startError: triage.startError,
    onValidate,
    onCancel: () => void triage.cancel(),
    failed,
    failedIsCancel: failed && panelStream.failureReason === 'aborted',
    failureMessage: panelStream.error,
    onGotoBoard,
    postDialog,
    onOpenPostDialog: () => void onOpenPostDialog(),
    onClosePostDialog: () => setPostDialog((p) => ({ ...p, open: false })),
    onSubmitPost: () => void onSubmitPost(),
    convertDialog,
    suggestedKind:
      panelStream.result !== null
        ? suggestedTaskKind(panelStream.result.issueKind, complexity)
        : 'Build',
    complexityLabel: complexity !== null ? COMPLEXITY_META[complexity].label : null,
    effortLabel: complexity !== null ? COMPLEXITY_TO_EFFORT[complexity] : null,
    alreadyLinked: panelStream.linkedTaskId !== null,
    onOpenConvertDialog: () => setConvertDialog({ open: true, converting: false, error: null }),
    onCloseConvertDialog: () => setConvertDialog((c) => ({ ...c, open: false })),
    onSubmitConvert: () => void onSubmitConvert(),
  };
}
