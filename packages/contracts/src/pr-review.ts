import { z } from 'zod';

import { runTotals, TokenUsageSchema } from './event-fragments.js';

/**
 * `@nightcore/contracts` — PR Review (GitHub pull-request review) shapes.
 *
 * The fourth scan sibling (alongside Insight / Harness / Scorecard). It reviews a
 * GitHub pull request of the current project as a set of read-only per-LENS passes
 * that each emit STRUCTURED findings grounded against the PR's changed-file set
 * (DIFF-relative, not disk-relative — a PR that adds `new.rs` has no `new.rs` in the
 * current checkout, so disk-grounding would wrongly drop it). One unified severity
 * scale spans every lens so findings sort/filter/rank globally.
 *
 * Zod-only: this module imports nothing from `commands.ts`/`events.ts` so those can
 * import {@link ReviewFindingSchema} / {@link ReviewLensSchema} without a cycle.
 *
 * NAMING: the eslint `zod-schema-naming` rule (error on contracts) carves out only
 * `Event|Command|Query` suffixes; the finding schema is deliberately named
 * `ReviewFindingSchema` (NOT `...Command/Event/Query`) so the rule does not fire.
 */

/** The review lenses. Each is one read-only pass and one UI focus. The wire strings
 *  are single lowercase words so they survive codegen as clean enum variants. */
export const ReviewLensSchema = z.enum([
  'security',
  'logic',
  'structure',
  'tests',
  'contracts',
]);
export type ReviewLens = z.infer<typeof ReviewLensSchema>;

/** ONE severity scale for every lens. Ordered low→high for global ranking. Shares
 *  its value-set with the Insight severity scale (they collapse to one generated Rust
 *  enum). */
export const ReviewSeveritySchema = z.enum([
  'info',
  'low',
  'medium',
  'high',
  'critical',
]);
export type ReviewSeverity = z.infer<typeof ReviewSeveritySchema>;

/** The overall MERGE VERDICT the synthesis pass assigns to the whole PR after every
 *  lens + the adversarial validator have run — one coarse recommendation spanning all
 *  findings, ordered mergeable → blocked. Emitted additively + optionally on the wire
 *  (see the `pr-review-completed` event): a run whose synthesis pass errors/times-out/
 *  cancels completes WITHOUT it (fail-open), and an older engine that never runs the
 *  pass simply omits it. Named `MergeVerdictSchema` (NOT `...Command/Event/Query`) so
 *  the `zod-schema-naming` rule does not fire — same carve-out as the finding schema. */
export const MergeVerdictSchema = z.enum([
  'ready',
  'merge_with_changes',
  'needs_revision',
  'blocked',
]);
export type MergeVerdict = z.infer<typeof MergeVerdictSchema>;

/**
 * One grounded PR-review finding. Flat (codegen can't do a tagged union inside a
 * struct). Lifecycle fields (status, linkedTaskId) are NOT here — owned Rust-side by
 * the `PrReviewStore`, applied on persist. The wire `ReviewFinding` is the engine's
 * review output only.
 */
export const ReviewFindingSchema = z.object({
  /** Stable id assigned by the engine (used for dedup, convert-to-task, UI keys). */
  id: z.string(),
  lens: ReviewLensSchema,
  severity: ReviewSeveritySchema,
  /** Repo-relative path; MUST be a changed file in the PR (diff-relative grounding). */
  file: z.string(),
  /** 1-based line in the PR head, when localizable. */
  line: z.number().int().positive().optional(),
  /** One-line headline. */
  title: z.string(),
  /** What the issue is, concretely. */
  body: z.string(),
  /** Concrete recommended fix, when the model articulates one. */
  suggestedFix: z.string().optional(),
  /** Stable content fingerprint (lens + normalized file + title) for dedup +
   *  dismissed-history across re-runs. */
  fingerprint: z.string(),
  /** Review lenses OTHER than {@link ReviewFindingSchema.shape.lens} that independently
   *  surfaced this same issue — populated by the cross-lens dedup when it collapses
   *  duplicate findings, so the corroborating signal survives the merge instead of
   *  being dropped. Additive + optional; absent when only the reporting lens found it. */
  corroboratedBy: z.array(ReviewLensSchema).optional(),
});
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

/**
 * PR Review events (the fourth scan sibling). Like the `analysis-*` family these carry
 * no `sessionId` and correlate by `runId`; the Rust reader routes the whole
 * `pr-review-*` family to the `nc:pr-review` channel and persists the run on
 * `pr-review-completed`. Each lens pass emits a batch of grounded findings over the PR
 * diff. `pr-review-finding-converted` is a Rust-emitted notice on the same channel (the
 * convert-to-task acknowledgement), part of the union so surfaces can narrow it.
 */

/** A run started. Echoes the resolved lenses/model for the UI header. */
export const PrReviewStartedEvent = z.object({
  type: z.literal('pr-review-started'),
  runId: z.string(),
  lenses: z.array(ReviewLensSchema),
  model: z.string(),
});

/** A lens pass began reviewing (the UI shows skeleton cards for it). */
export const PrReviewLensStartedEvent = z.object({
  type: z.literal('pr-review-lens-started'),
  runId: z.string(),
  lens: ReviewLensSchema,
});

/** A lens pass finished: its grounded findings stream in as a batch, plus the pass's
 *  own token usage and cost so the UI can show per-lens spend. */
export const PrReviewLensCompletedEvent = z.object({
  type: z.literal('pr-review-lens-completed'),
  runId: z.string(),
  lens: ReviewLensSchema,
  findings: z.array(ReviewFindingSchema),
  usage: TokenUsageSchema.optional(),
  costUsd: z.number().default(0),
  /** Set when the pass itself failed (parse/abort): findings is then empty and the UI
   *  marks the lens errored rather than "0 findings". */
  error: z.string().optional(),
});

/** The whole run finished: the final cross-lens-deduped findings plus run totals. The
 *  Rust reader persists from THIS event (authoritative). `lensesRun` is the count of
 *  lens passes that ran. */
export const PrReviewCompletedEvent = z.object({
  type: z.literal('pr-review-completed'),
  runId: z.string(),
  findings: z.array(ReviewFindingSchema),
  lensesRun: z.number().int().nonnegative(),
  ...runTotals,
  /** The synthesis pass's overall merge recommendation for the PR. Additive +
   *  optional (FAIL-OPEN): a synthesis pass that errors/times-out/cancels completes
   *  the run WITHOUT it, and an older engine that never runs the pass omits it. */
  verdict: MergeVerdictSchema.optional(),
  /** The synthesis pass's short (~120-word) justification for {@link verdict}. Present
   *  only when `verdict` is; same fail-open/additive posture. */
  verdictReasoning: z.string().optional(),
});

/** The run failed before completing (could not start, or aborted). `reason` is a free
 *  string (the manager's failure code) so a surface degrades on drift. */
export const PrReviewFailedEvent = z.object({
  type: z.literal('pr-review-failed'),
  runId: z.string(),
  reason: z.string(),
  message: z.string(),
});

/** A finding was converted into a board task. Emitted by the Rust convert command on
 *  the `nc:pr-review` channel (mirrors Insight's convert notice), not by the engine. */
export const PrReviewFindingConvertedEvent = z.object({
  type: z.literal('pr-review-finding-converted'),
  runId: z.string(),
  findingId: z.string(),
  taskId: z.string(),
});
