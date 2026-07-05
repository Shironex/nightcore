/**
 * Pure helpers for the Issue Triage pipeline — the parse → ground steps that turn the
 * validation pass's free-text result into ONE validated, grounded
 * {@link IssueValidationResult}. Kept pure (only `fs` via the shared helpers, no SDK,
 * no emitter) so every step is unit-testable in isolation. Mirrors
 * `scorecard/readings.ts`, reusing {@link extractJson} + {@link fileExists} +
 * {@link normalizeFile} VERBATIM (imported, not re-declared) so JSON extraction and
 * path grounding can never diverge from the other scans'.
 *
 * The model is asked for ONE object (not an array); the parse tolerates a one-element
 * array wrapper (the same tolerance as `parseReading`) and is otherwise strict about
 * the two fields that must not be fabricated — `verdict` and `reasoning` — so an
 * off-contract answer triggers the base's single corrective retry rather than a bogus
 * verdict. `issueKind` and `confidence` are coerced with a sensible fallback instead
 * (an honest `unknown`/`low`) because those never fabricate a decision.
 */
import {
  type IssueComplexity,
  type IssueConfidence,
  type IssueKind,
  type IssuePrAnalysis,
  IssuePrAnalysisSchema,
  type IssuePrRecommendation,
  type IssueValidationResult,
  IssueValidationResultSchema,
  type IssueVerdict,
} from '@nightcore/contracts';

import {
  getBoolean,
  getNumber,
  getString,
  getStringArray,
} from '../../util/field-extract.js';
import { extractJson, fileExists, normalizeFile } from '../shared/findings.js';

const ISSUE_KINDS: readonly IssueKind[] = [
  'bug_report',
  'feature_request',
  'question',
  'unknown',
];
const VERDICTS: readonly IssueVerdict[] = [
  'valid',
  'invalid',
  'needs_clarification',
];
const CONFIDENCES: readonly IssueConfidence[] = ['high', 'medium', 'low'];
const COMPLEXITIES: readonly IssueComplexity[] = [
  'trivial',
  'simple',
  'moderate',
  'complex',
  'very_complex',
];
const RECOMMENDATIONS: readonly IssuePrRecommendation[] = [
  'wait_for_merge',
  'pr_needs_work',
  'no_pr',
];

/** Normalize an enum-ish raw value: lowercase, trim, collapse spaces/hyphens to `_`. */
function canon(raw: unknown): string {
  return String(raw).toLowerCase().trim().replace(/[\s-]+/g, '_');
}

/** Coerce the issue kind, tolerating common synonyms. Never errors — an unrecognized
 *  value falls to the honest `unknown` (a valid enum member), so classification alone
 *  never triggers the corrective retry. */
function coerceIssueKind(raw: unknown): IssueKind {
  const v = canon(raw);
  if ((ISSUE_KINDS as readonly string[]).includes(v)) return v as IssueKind;
  if (v === 'bug' || v === 'defect' || v === 'bug_report') return 'bug_report';
  if (v === 'feature' || v === 'enhancement' || v === 'feature_request') {
    return 'feature_request';
  }
  if (v === 'question' || v === 'support' || v === 'help') return 'question';
  return 'unknown';
}

/** Validate the verdict strictly (the core decision — must NOT be fabricated). Returns
 *  `undefined` for an off-contract value so the caller errors and the retry re-asks. */
function validVerdict(raw: unknown): IssueVerdict | undefined {
  const v = canon(raw);
  if ((VERDICTS as readonly string[]).includes(v)) return v as IssueVerdict;
  if (v === 'needs_info' || v === 'unclear' || v === 'incomplete') {
    return 'needs_clarification';
  }
  return undefined;
}

/** Coerce confidence with an honest fallback to `low` (least authoritative) rather
 *  than erroring — a missing confidence should not lose the whole verdict. */
function coerceConfidence(raw: unknown): IssueConfidence {
  const v = canon(raw);
  if ((CONFIDENCES as readonly string[]).includes(v)) return v as IssueConfidence;
  if (v === 'med') return 'medium';
  return 'low';
}

/** Validate estimated complexity to a canonical value, or `undefined` (it is optional
 *  — an off-scale value is simply dropped, never faked). */
function validComplexity(raw: unknown): IssueComplexity | undefined {
  if (raw === undefined || raw === null) return undefined;
  const v = canon(raw);
  return (COMPLEXITIES as readonly string[]).includes(v)
    ? (v as IssueComplexity)
    : undefined;
}

/** Validate a PR recommendation to a canonical value, or `undefined`. */
function validRecommendation(raw: unknown): IssuePrRecommendation | undefined {
  if (raw === undefined || raw === null) return undefined;
  const v = canon(raw);
  return (RECOMMENDATIONS as readonly string[]).includes(v)
    ? (v as IssuePrRecommendation)
    : undefined;
}

/** Coerce the optional `prAnalysis` sub-object. Tolerant: a present-but-malformed
 *  analysis is DROPPED (it is optional), never fatal to the whole verdict. When the
 *  recommendation is off-contract we derive it from the authoritative `hasOpenPr`
 *  flag (`no_pr` when false, else `pr_needs_work`) rather than fail. */
function coercePrAnalysis(raw: unknown): IssuePrAnalysis | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const hasOpenPr = getBoolean(r, 'hasOpenPr') ?? false;
  const recommendation =
    validRecommendation(r.recommendation) ??
    (hasOpenPr ? 'pr_needs_work' : 'no_pr');
  const prNumber = getNumber(r, 'prNumber');
  const prFixesIssue = getBoolean(r, 'prFixesIssue');
  const prSummary = getString(r, 'prSummary');
  const candidate: Record<string, unknown> = {
    hasOpenPr,
    recommendation,
    ...(prNumber !== undefined && Number.isInteger(prNumber) && prNumber > 0
      ? { prNumber }
      : {}),
    ...(prFixesIssue !== undefined ? { prFixesIssue } : {}),
    ...(prSummary !== undefined ? { prSummary } : {}),
  };
  const parsed = IssuePrAnalysisSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Parse the validation pass's raw result text into ONE validated
 * {@link IssueValidationResult}. Tolerant of prose/```json fences (via
 * {@link extractJson}) and of a one-element array wrapper. Returns `{ verdict }` on
 * success, or `{ error }` when no JSON object could be extracted OR the two
 * non-fabricatable fields (`verdict`, `reasoning`) are absent/off-contract — so the
 * orchestrator can fire its single corrective retry rather than surface a bogus
 * verdict.
 */
export function parseIssueVerdict(raw: string): {
  verdict?: IssueValidationResult;
  error?: string;
} {
  const parsed = extractJson(raw);
  if (parsed === undefined) {
    return { error: 'no JSON verdict object in model output' };
  }
  // The model is asked for a single object; tolerate a one-element array wrapper.
  const obj = Array.isArray(parsed) ? parsed[0] : parsed;
  if (obj === null || typeof obj !== 'object') {
    return { error: 'model output was not a verdict object' };
  }
  const r = obj as Record<string, unknown>;

  const verdict = validVerdict(r.verdict);
  if (verdict === undefined) {
    return { error: `verdict has no valid value (got ${JSON.stringify(r.verdict)})` };
  }
  const reasoning = getString(r, 'reasoning');
  if (reasoning === undefined || reasoning.trim().length === 0) {
    return { error: 'verdict missing reasoning' };
  }

  const bugConfirmed = getBoolean(r, 'bugConfirmed');
  const estimatedComplexity = validComplexity(r.estimatedComplexity);
  const proposedPlan = getString(r, 'proposedPlan');
  const prAnalysis = coercePrAnalysis(r.prAnalysis);

  const candidate: Record<string, unknown> = {
    issueKind: coerceIssueKind(r.issueKind),
    verdict,
    confidence: coerceConfidence(r.confidence),
    reasoning,
    ...(bugConfirmed !== undefined ? { bugConfirmed } : {}),
    relatedFiles: getStringArray(r, 'relatedFiles')
      .map(normalizeFile)
      .filter((f) => f.length > 0),
    ...(estimatedComplexity !== undefined ? { estimatedComplexity } : {}),
    ...(proposedPlan !== undefined ? { proposedPlan } : {}),
    missingInfo: getStringArray(r, 'missingInfo'),
    ...(prAnalysis !== undefined ? { prAnalysis } : {}),
  };

  const result = IssueValidationResultSchema.safeParse(candidate);
  return result.success
    ? { verdict: result.data }
    : { error: 'verdict failed schema validation' };
}

/**
 * Ground a verdict against the real tree: drop any `relatedFiles` path that does not
 * resolve to a real file inside the project root (a hallucinated ref) rather than
 * failing the run — the production fix over a model that deep-links to files it never
 * read. The containment check inside {@link fileExists} also rejects any `../` escape.
 */
export function groundIssueVerdict(
  verdict: IssueValidationResult,
  projectPath: string,
): IssueValidationResult {
  return {
    ...verdict,
    relatedFiles: verdict.relatedFiles.filter((f) => fileExists(projectPath, f)),
  };
}
