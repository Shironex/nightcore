/** Static display metadata for the Issue Triage enums — labels + Tailwind tone/chip
 *  classes for the verdict/kind/confidence/complexity/PR-recommendation badges, the
 *  complexity→effort display mapping, and the suggested-task-kind helper (which
 *  mirrors the Rust `task_kind_for` so the convert dialog previews the same kind the
 *  backend will mint). */
import type {
  IssueComplexity,
  IssueConfidence,
  IssueKind,
  IssuePrRecommendation,
  IssueVerdict,
} from '@/lib/bridge';

/** A badge's Tailwind tones — `tone` colors the text, `chip` the bg + border.
 *  Matches the shared `SEVERITY_META` shape so all triage badges read consistently. */
export interface BadgeTone {
  label: string;
  tone: string;
  chip: string;
}

/** What the issue IS (kind axis). */
export const KIND_META: Record<IssueKind, { label: string }> = {
  bug_report: { label: 'Bug report' },
  feature_request: { label: 'Feature request' },
  question: { label: 'Question' },
  unknown: { label: 'Unknown' },
};

/** Whether the issue is actionable as written (verdict axis) — the headline badge. */
export const VERDICT_META: Record<IssueVerdict, BadgeTone> = {
  valid: {
    label: 'Valid',
    tone: 'text-success',
    chip: 'bg-success/[0.12] border-success/40',
  },
  invalid: {
    label: 'Invalid',
    tone: 'text-destructive',
    chip: 'bg-destructive/[0.12] border-destructive/40',
  },
  needs_clarification: {
    label: 'Needs clarification',
    tone: 'text-warning',
    chip: 'bg-warning/[0.12] border-warning/40',
  },
};

/** The model's self-rated confidence in its verdict. */
export const CONFIDENCE_META: Record<IssueConfidence, { label: string }> = {
  high: { label: 'High confidence' },
  medium: { label: 'Medium confidence' },
  low: { label: 'Low confidence' },
};

/** Estimated implementation effort, ordered trivial→very_complex. */
export const COMPLEXITY_META: Record<IssueComplexity, { label: string }> = {
  trivial: { label: 'Trivial' },
  simple: { label: 'Simple' },
  moderate: { label: 'Moderate' },
  complex: { label: 'Complex' },
  very_complex: { label: 'Very complex' },
};

/** The recommendation when the issue has a linked open PR. */
export const PR_RECOMMENDATION_META: Record<IssuePrRecommendation, { label: string; hint: string }> =
  {
    wait_for_merge: {
      label: 'Wait for merge',
      hint: 'An open PR already fixes this — wait for it to merge.',
    },
    pr_needs_work: {
      label: 'PR needs work',
      hint: 'An open PR targets this but does not fully fix it yet.',
    },
    no_pr: {
      label: 'No fixing PR',
      hint: 'No open PR fixes this issue.',
    },
  };

/** Display mapping from the model's estimated complexity to a board effort label.
 *  INFORMATIONAL only in the convert dialog — the Rust convert sets the task kind but
 *  leaves effort at its default; this shows the user the suggested sizing. */
export const COMPLEXITY_TO_EFFORT: Record<IssueComplexity, string> = {
  trivial: 'Trivial',
  simple: 'Small',
  moderate: 'Medium',
  complex: 'Large',
  very_complex: 'Large',
};

/** The board task kind the convert will mint — mirrors the Rust `task_kind_for`: a
 *  complex/very-complex FEATURE request becomes a `Decompose` (it needs breaking down
 *  first); everything else (bugs, simple features, questions) becomes a `Build`. */
export function suggestedTaskKind(
  issueKind: IssueKind,
  complexity: IssueComplexity | null,
): 'Build' | 'Decompose' {
  const isComplex = complexity === 'complex' || complexity === 'very_complex';
  return issueKind === 'feature_request' && isComplex ? 'Decompose' : 'Build';
}
