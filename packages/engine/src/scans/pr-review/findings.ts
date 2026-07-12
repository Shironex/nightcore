/**
 * Pure helpers for the PR Review pipeline — the parse → ground → dedup steps that
 * turn a lens pass's free-text result into validated, DIFF-GROUNDED, de-duplicated
 * {@link ReviewFinding}s. Mirrors the Insight `shared/findings.ts` (and REUSES its
 * `extractJson` + `coerceLocation` + `normalizeFile` primitives) so the features
 * parse the model the same way, but grounds DIFF-RELATIVE rather than disk-relative:
 *
 * A PR that ADDS `new.rs` has no `new.rs` in the current checkout, so disk-grounding
 * (does the file exist on disk?) would wrongly drop a real finding. Instead a finding
 * is kept iff its `file` is a member of the PR's `changedFiles` set, and line numbers
 * are NOT clamped to disk length (we don't have the PR-head file). This is the whole
 * reason the scan reviews the diff without a checkout — see the phase-4 contract §0.
 *
 * Kept pure (only `crypto`, no SDK, no emitter, no `fs`) so every step is
 * unit-testable in isolation.
 */
import { createHash } from 'node:crypto';

import {
  type ReviewFinding,
  ReviewFindingSchema,
  type ReviewLens,
  type ReviewSeverity,
} from '@nightcore/contracts';

import { dedupeBy } from '../../util/dedupe.js';
import { getNumber, getString } from '../../util/field-extract.js';
import { parseItems, toRawArray } from '../../util/json-extract.js';
import {
  coerceLocation,
  coerceSeverity,
  normalizeFile,
  normalizeTitle,
  severityRank,
} from '../shared/findings.js';

/** Numeric rank for a review severity (info=0 … critical=4), for ordering and merge.
 *  Delegates to the shared rank table (the value-set is identical across scans). */
export function reviewSeverityRank(s: ReviewSeverity): number {
  return severityRank(s);
}

/**
 * Stable content fingerprint for a review finding: `lens | normalized-file | title`.
 * Line-independent (a one-line drift between re-runs must not break the
 * dismissed-history match the Rust store keys on) and lens-scoped (the same headline
 * means different things under `security` vs `structure`). Used both to carry
 * dismissed-history across re-runs AND to dedup across lens passes, so the two can
 * never diverge. Returns a short hex digest.
 */
export function reviewFingerprint(
  lens: ReviewLens,
  file: string,
  title: string,
): string {
  const basis = `${lens}|${normalizeFile(file)}|${normalizeTitle(title)}`;
  return createHash('sha1').update(basis).digest('hex').slice(0, 16);
}

/** Keep a line number only when it is a positive integer (the contract's shape);
 *  anything else is dropped so the whole finding does not fail schema validation. */
function coerceLine(raw: number | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!Number.isInteger(raw) || raw < 1) return undefined;
  return raw;
}

/**
 * Coerce one raw model item into a contract {@link ReviewFinding}, forcing `lens`
 * (the pass owns it, not the model) and assigning a stable id + fingerprint. Accepts
 * the flat `{ file, line }` shape the contract wants and, defensively, a nested
 * `location` object or a `"file:line"` string (the model occasionally reports one).
 * A finding with no locatable `file` is dropped (the contract requires it, and
 * diff-relative grounding is meaningless without a file). Returns `undefined` when
 * the item can't satisfy the schema.
 */
function coerceReviewFinding(
  raw: unknown,
  lens: ReviewLens,
): ReviewFinding | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;

  const title = getString(r, 'title');
  // `body` is the contract field; accept `description` as a fallback (the analyzer
  // vocabulary the model sometimes reaches for).
  const body = getString(r, 'body') ?? getString(r, 'description');
  if (title === undefined || body === undefined) return undefined;

  // `coerceLocation` normalizes the path and parses a `"file:line"` string; feed it
  // either the flat `file` field or a nested `location`.
  const loc = coerceLocation(r.location ?? r.file);
  const file = loc?.file;
  if (file === undefined || file.length === 0) return undefined;

  const line = coerceLine(getNumber(r, 'line') ?? loc?.startLine);
  const suggestedFix = getString(r, 'suggestedFix') ?? getString(r, 'suggestion');
  const fingerprint = reviewFingerprint(lens, file, title);

  const candidate: Record<string, unknown> = {
    id: `${lens}-${fingerprint}`,
    lens,
    severity: coerceSeverity(r.severity),
    file,
    ...(line !== undefined ? { line } : {}),
    title,
    body,
    ...(suggestedFix !== undefined ? { suggestedFix } : {}),
    fingerprint,
  };

  const result = ReviewFindingSchema.safeParse(candidate);
  return result.success ? result.data : undefined;
}

/**
 * The SDK `Options.outputFormat` for a PR-review LENS pass — a JSON-Schema request
 * that makes the SDK return native structured output conforming to
 * `{ findings: [{ severity, file, line, title, body, suggestedFix }] }` (retrying
 * non-conforming output internally, and failing terminally with
 * `error_max_structured_output_retries` rather than silently emitting prose). This is
 * the RELIABILITY substrate the verdict clamp depends on: `severity` comes back as a
 * validated enum instead of a best-effort-parsed string. Mirrors the fields the model
 * supplies in `prReviewOutputContract` — engine-assigned fields (`lens`, `id`,
 * `fingerprint`) are deliberately OUT of the schema, exactly as they are out of the
 * prose contract.
 *
 * Structured-output schemas require `additionalProperties: false` at every object
 * level. Optional fields (`line`, `suggestedFix`) are modelled as nullable AND listed
 * in `required` — under strict structured output every property key must appear in
 * `required`, so the model always emits them (as `null` when not applicable) and the
 * shared coercion below drops the null (a null `line`/`suggestedFix` reads as absent).
 * Typed structurally (not via the SDK's `OutputFormat`) so this module stays
 * SDK-import-free; the shape is assignable to `OutputFormat` at the preset seam —
 * identical to the `decompose` template.
 */
export const PR_REVIEW_OUTPUT_FORMAT: {
  type: 'json_schema';
  schema: Record<string, unknown>;
} = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            severity: {
              type: 'string',
              enum: ['info', 'low', 'medium', 'high', 'critical'],
            },
            file: { type: 'string' },
            line: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
            title: { type: 'string' },
            body: { type: 'string' },
            suggestedFix: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          },
          required: ['severity', 'file', 'line', 'title', 'body', 'suggestedFix'],
          additionalProperties: false,
        },
      },
    },
    required: ['findings'],
    additionalProperties: false,
  },
};

/**
 * Validated findings from the SDK's native `structured_output` (the result message's
 * schema-conforming object built from {@link PR_REVIEW_OUTPUT_FORMAT}). Returns the
 * clean array — possibly `[]` when the lens legitimately reported nothing — whenever
 * structured output is PRESENT, and `undefined` when it is ABSENT (`null`/`undefined`),
 * which signals the caller to fall back to text parsing ({@link parsePrReviewFindings}).
 * Runs every item through the SAME {@link coerceReviewFinding} the text path uses (so
 * `lens`/`id`/`fingerprint` are engine-assigned and the two paths can never drift) and
 * tolerates the `{ findings: [...] }` wrapper or a bare array via `toRawArray`. Never
 * throws. Mirrors the `decompose` `subtasksFromStructuredOutput` template.
 */
export function findingsFromStructuredOutput(
  structuredOutput: unknown,
  lens: ReviewLens,
): ReviewFinding[] | undefined {
  if (structuredOutput === null || structuredOutput === undefined) {
    return undefined;
  }
  const out: ReviewFinding[] = [];
  for (const item of toRawArray(structuredOutput, 'findings')) {
    const finding = coerceReviewFinding(item, lens);
    if (finding !== undefined) out.push(finding);
  }
  return out;
}

/**
 * Parse a lens pass's raw result text into validated findings. Tolerant: malformed
 * items are skipped, not fatal. Returns the parsed findings plus an `error` when NO
 * JSON could be extracted at all, OR when the extracted JSON is neither an array nor
 * an object exposing a `findings` array (an incidental JSON example in a prose
 * answer) — so the orchestrator can drive its single corrective retry / mark the
 * lens errored vs legitimately empty. This is the FALLBACK path used when the SDK
 * returned no native `structured_output` (an older/degraded run, or a provider that
 * did not honor `outputFormat`).
 */
export function parsePrReviewFindings(
  raw: string,
  lens: ReviewLens,
): { findings: ReviewFinding[]; error?: string } {
  const { items, error } = parseItems(
    raw,
    'findings',
    (item) => coerceReviewFinding(item, lens),
    'no JSON review findings in model output',
  );
  return { findings: items, ...(error !== undefined ? { error } : {}) };
}

/**
 * DIFF-RELATIVE grounding: keep a finding iff its `file` is a member of the PR's
 * changed-file set, and DROP the rest. This is deliberately NOT disk existence — a PR
 * adds files that are not in the current checkout, and reviews the diff, not a
 * checkout of the PR head. Line numbers are NOT clamped (we have no PR-head file to
 * clamp against). Paths are normalized on both sides so `./a`, `a`, and `a\` compare
 * equal.
 */
export function groundPrReviewFindings(
  findings: ReviewFinding[],
  changedFiles: readonly string[],
): ReviewFinding[] {
  const changed = new Set(changedFiles.map((f) => normalizeFile(f)));
  return findings.filter((f) => changed.has(normalizeFile(f.file)));
}

/**
 * Cross-lens dedup + corroboration: when two lens passes surface the SAME issue, keep
 * ONE — the higher-severity instance — and record the OTHER reporting lenses on the
 * survivor's `corroboratedBy` so the cross-lens agreement signal survives the merge
 * instead of being silently dropped. The grouping key is lens-INDEPENDENT
 * (`normalized-file | normalized-title`): the per-finding `fingerprint` is lens-scoped
 * (`lens | file | title`), so keying on it would keep two lenses' readings of one issue
 * as separate findings and there would be nothing to corroborate. Order-stable on first
 * appearance; on a severity tie the first-seen finding wins (lens fan-out order is
 * deterministic). The survivor RETAINS its own lens-scoped `fingerprint`, which is what
 * the Rust store keys dismissed/converted-history on — so history still matches a real
 * fingerprint; only genuine cross-lens duplicates now collapse.
 */
export function dedupePrReviewFindings(
  findings: ReviewFinding[],
): ReviewFinding[] {
  const keyOf = (f: ReviewFinding): string =>
    `${normalizeFile(f.file)}|${normalizeTitle(f.title)}`;
  // Every lens that reported an issue under a key, so the survivor can list its
  // corroborators (the reporting lenses beyond its own).
  const lensesByKey = new Map<string, Set<ReviewLens>>();
  for (const finding of findings) {
    const key = keyOf(finding);
    const lenses = lensesByKey.get(key) ?? new Set<ReviewLens>();
    lenses.add(finding.lens);
    lensesByKey.set(key, lenses);
  }
  const survivors = dedupeBy(findings, keyOf, {
    rank: (f) => reviewSeverityRank(f.severity),
  });
  return survivors.map((winner) => {
    const corroborators = [...(lensesByKey.get(keyOf(winner)) as Set<ReviewLens>)]
      .filter((lens) => lens !== winner.lens)
      .sort();
    return corroborators.length > 0
      ? { ...winner, corroboratedBy: corroborators }
      : winner;
  });
}
