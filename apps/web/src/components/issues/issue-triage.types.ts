/**
 * Issue Triage view-model types. The wire verdict (`IssueValidationResult`, from the
 * `issue-validation-completed` event) and the persisted one (`StoredIssueValidationResult`,
 * string-typed ts-rs) are both projected into the single {@link IssueVerdictView} the
 * UI renders — mirroring how Insight folds `Finding` / `StoredFinding` into
 * `InsightFinding`. Every GitHub-sourced / model-prose string here is UNTRUSTED and
 * must render through the sanitized `<Markdown>` framing.
 */
import type {
  IssueComplexity,
  IssueConfidence,
  IssueKind,
  IssuePrRecommendation,
  IssueVerdict,
} from '@/lib/bridge';

/** The live/persisted status of a single validation. Structurally identical to the
 *  shared scan `RunStatus`; `idle` is live-only (no run selected). */
export type IssueRunStatus = 'idle' | 'running' | 'completed' | 'failed';

/** The analysis of a linked open PR, narrowed from the wire/stored string shape. */
export interface IssuePrAnalysisView {
  hasOpenPr: boolean;
  prNumber: number | null;
  prFixesIssue: boolean | null;
  /** Model prose derived from an untrusted diff — render as untrusted. */
  prSummary: string | null;
  recommendation: IssuePrRecommendation;
}

/** One validation verdict, projected from either the wire result or the persisted
 *  run into the single shape the results panel renders. `reasoning` / `proposedPlan`
 *  / `prSummary` are model prose over attacker-controlled input (untrusted). */
export interface IssueVerdictView {
  issueKind: IssueKind;
  verdict: IssueVerdict;
  confidence: IssueConfidence;
  reasoning: string;
  bugConfirmed: boolean | null;
  /** Repo-relative paths the engine grounded against the checkout. */
  relatedFiles: string[];
  estimatedComplexity: IssueComplexity | null;
  proposedPlan: string | null;
  missingInfo: string[];
  prAnalysis: IssuePrAnalysisView | null;
}
