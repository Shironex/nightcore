import { z } from 'zod';

/**
 * `@nightcore/contracts` — Harness ENFORCE-lite shapes (rule-coverage detection).
 *
 * Phase-1 ENFORCE ships **coverage, not conformance**: for each observed
 * convention it reports whether an enforcing lint/meta rule covers it
 * (`enforced`), an agent doc merely claims it (`documented-only`), or nothing
 * does (`unenforced`). It does NOT yet check whether a convention is FOLLOWED at
 * every site — that is Phase-2 "convention drift". Coverage is computed by a cheap
 * deterministic rule-inventory extraction plus one no-tool LLM join in the Harness
 * scan's `finalize`, and rides the existing `harness-scan-completed` event
 * additively (see {@link HarnessScanCompletedEvent} in `harness.ts`).
 *
 * The stable join key is the convention's `conventionFingerprint` (the
 * `category | normalized-title` sha1 the engine already assigns, `findings.ts`),
 * so these shapes never need a migration when drift arrives — a `ConventionDrift`
 * record (Phase 2) will key on the same fingerprint. Zod-only: this file imports
 * nothing else in the contract spine (in particular NOT `harness.ts`), so
 * `harness.ts` can import `RuleCoverageGapSchema` for its completed-event field
 * without a cycle.
 */

/**
 * A convention's enforcement coverage status. Wire strings are kebab-case so they
 * survive codegen as a clean `CoverageStatus` Rust enum (`rename_all = "kebab-case"`).
 *   - `enforced`        — a lint/meta rule (or armed gauntlet check) covers it.
 *   - `documented-only` — an agent doc (CLAUDE.md / AGENTS.md) claims it, but no
 *                         rule enforces it (the `agent-contract-parity` insight
 *                         inverted: docs without teeth).
 *   - `unenforced`      — neither a rule nor a doc covers it.
 */
export const CoverageStatusSchema = z.enum([
  'enforced',
  'documented-only',
  'unenforced',
]);
export type CoverageStatus = z.infer<typeof CoverageStatusSchema>;

/**
 * One convention's enforcement-coverage report — exactly one record per
 * convention, keyed on `conventionFingerprint`. Flat and lifecycle-free (coverage
 * is recomputed every scan; there is no user-editable state to persist), so it
 * codegens to a lean Rust struct. Mirrors the `ConventionFinding` shape's discipline:
 * enum-ish `category` rides as a bare wire string (kept lenient here to avoid a
 * `harness.ts` import cycle; the web casts it to `ConventionCategory`).
 */
export const RuleCoverageGapSchema = z.object({
  /** Stable id assigned by the engine (`coverage-<conventionFingerprint>`; UI keys). */
  id: z.string(),
  /** The convention this covers — its `category | normalized-title` sha1 (the join key). */
  conventionFingerprint: z.string(),
  /** The convention's lens (a `ConventionCategory` wire string; the web casts it). */
  category: z.string(),
  /** The convention, restated as the rule that was checked for coverage. */
  title: z.string(),
  status: CoverageStatusSchema,
  /** Enforcing rule ids that cover it (`nightcore/no-cross-feature-imports`, a
   *  lint-meta id, an armed gauntlet-check name). Empty unless `status === 'enforced'`. */
  enforcedBy: z.array(z.string()).default([]),
  /** Agent-doc claim lines that mention it (guardrail heading / rule-name text).
   *  Populated for `documented-only`. */
  documentedIn: z.array(z.string()).default([]),
  /** What synthesis (PROPOSE) could generate to close the gap — an `ArtifactKind`
   *  wire string, kept lenient (never trusted as a hard enum). */
  suggestedArtifactKind: z.string().optional(),
  /** Stable fingerprint — the `conventionFingerprint` (one coverage record per
   *  convention), so acknowledged-coverage carry-forward can key on it later. */
  fingerprint: z.string(),
});
export type RuleCoverageGap = z.infer<typeof RuleCoverageGapSchema>;
