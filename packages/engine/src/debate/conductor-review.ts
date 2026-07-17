/**
 * The Council adversarial REVIEW stage (issue #369, P2) — an independent, adversarial
 * pass over the single-writer Build's diff BEFORE the human Converge, reusing the PR
 * system's phase-4 diff-centric reviewer rather than inventing a new one.
 *
 * Review slots between Build and Converge: after the elected writer produced a diff on
 * an isolated worktree (`conductor-build.ts`), a SEPARATE reviewer independently critiques
 * that diff adversarially, so a confident-but-wrong build is caught before acceptance. It
 * mirrors the {@link import('./objective-gate.js').ObjectiveGate} and {@link
 * import('./build-writer.js').BuildDriver} seams exactly:
 *
 *  - **Exec-neutral seam.** The engine NEVER spawns a process here. A {@link ReviewDriver}
 *    maps `context → result`; how the verdict is produced (an injected reviewer over the
 *    real PR phase-4 machinery in production, a deterministic fake in tests) lives behind
 *    the seam, so the whole stage + its safety invariants are drivable with a fake — no
 *    live session. Production REUSES the diff-centric `pr_review` reviewer (its read-only
 *    per-lens passes + adversarial validation + merge verdict), grounding on the writer's
 *    isolated worktree; it introduces NO new exec sink.
 *  - **The verdict is UNTRUSTED DATA, never authority (safety #2 + #6 + #7).** The reviewer
 *    is an AI session reviewing an attacker-influencable diff, so its output is quarantined:
 *    the finding text is injection-scanned and delivered QUOTED, recorded onto the
 *    append-only transcript THROUGH the mediated bus ({@link ConductorBus.note}, never a
 *    direct store write — safety #1/#7). The verdict is ADVISORY: nothing reads it to
 *    decide acceptance. The OBJECTIVE GATE still outranks it (safety #6 — a passing Review
 *    can NEVER relax a red gate), and the human remains terminal (safety #7). A malicious
 *    diff or a manipulated review therefore cannot forge acceptance.
 *
 * The stage is TRIPLE-GATED off by default: it runs ONLY when the preset declares a
 * `review` stage AND a {@link ReviewDriver} is injected AND a Build produced a diff to
 * review. P1 / pure-reasoning presets (no build, no review stage) never Review.
 */
import type {
  CouncilPreset,
  MergeVerdict,
  ReviewFinding,
  ReviewSeverity,
  TokenUsage,
} from '@nightcore/contracts';
import type { Logger } from '@nightcore/shared';

import type { ConductorBus } from './bus.js';
// Type-only imports (erased at runtime — no import cycle): the Review orchestration
// consumes the run inputs the Conductor already assembled and the Build stage's outcome.
import type { CouncilRunInput } from './conductor.js';
import type { RunGovernor } from './conductor-budget.js';
import type { BuildOutcome } from './conductor-build.js';
import { quoteForSeat } from './quoted-delivery.js';

/** The attribution id the reviewer's UNTRUSTED text is quoted under on the transcript.
 *  The adversarial reviewer is not a preset seat — it is a driver, like the objective
 *  gate — so this is a fixed, system-minted label (never agent-supplied), mirroring the
 *  Build stage's non-seat plan-recipient sentinel. */
const REVIEW_CRITIC_ATTRIBUTION = 'review-critic';

/** Merge verdicts that count as PASSING adversarial review — the diff may stand (pending
 *  the objective gate + the human). `needs_revision` / `blocked` are FAILING. This is the
 *  same coarse recommendation the PR phase-4 synthesis pass emits, mapped to a pass/fail. */
const REVIEW_PASS_VERDICTS: ReadonlySet<MergeVerdict> = new Set<MergeVerdict>([
  'ready',
  'merge_with_changes',
]);

/** Severity rank (low→high) for surfacing the worst finding the reviewer flagged. */
const SEVERITY_ORDER: readonly ReviewSeverity[] = [
  'info',
  'low',
  'medium',
  'high',
  'critical',
];

/**
 * What the Conductor hands the reviewer at Review. It reviews the writer's DIFF — grounded
 * on the isolated worktree the Build produced (diff-relative, exactly like the PR phase-4
 * reviewer grounds on a PR's changed files) — against the run's success criterion.
 */
export interface ReviewContext {
  readonly councilRunId: string;
  readonly objective: string;
  readonly successCriterion: string;
  /** The elected writer's seat id — whose diff is under adversarial review. */
  readonly writerSeatId: string;
  /** The writer's recorded diff/change summary (the Build output the reviewer critiques). */
  readonly diffSummary: string;
  /** The isolated worktree the writer built in — where the diff to review lives. The
   *  production reviewer runs its READ-ONLY passes grounded here (no execution surface —
   *  the diff is untrusted material, never run). Absent ⇒ a degraded/fake driver. */
  readonly worktreePath?: string;
  /** Aborts on kill/budget (safety #4) so the reviewer session is torn down. */
  readonly signal: AbortSignal;
}

/**
 * What the reviewer produced — deliberately the PR phase-4 reviewer's OWN output contract
 * ({@link ReviewFinding} + {@link MergeVerdict}), REUSED not reinvented, so the production
 * adapter over `pr_review` maps its result straight through. `usage`/`costUsd` are charged
 * against the run budget (the reviewer is a real session, like the writer).
 */
export interface ReviewResult {
  /** The grounded, diff-relative findings the adversarial reviewer surfaced. */
  readonly findings: readonly ReviewFinding[];
  /** The synthesis pass's overall merge recommendation for the diff. */
  readonly verdict: MergeVerdict;
  /** Token usage for the review session (charged against `budget.maxTotalTokens`). */
  readonly usage: TokenUsage;
  /** Cost in USD for the review session (charged against `budget.maxCostUsd`). */
  readonly costUsd: number;
}

/**
 * The provider/exec-neutral seam the Conductor drives the adversarial reviewer through.
 * ONE method: independently review the writer's diff and return its verdict. The engine
 * NEVER spawns a process or a session here — that is the injected implementation's job (the
 * real PR phase-4 diff reviewer in production, a deterministic fake in tests), mirroring
 * {@link import('./objective-gate.js').ObjectiveGate} and {@link
 * import('./build-writer.js').BuildDriver}. Until such a driver is injected the Review
 * stage stays DORMANT (see {@link runReview}).
 */
export interface ReviewDriver {
  review(context: ReviewContext): Promise<ReviewResult>;
}

/**
 * The ADVISORY verdict the Review stage records for the run — derived from {@link
 * ReviewResult}, carried onto the parked Converge decision so the human weighs it beside
 * the objective gate. It is DATA: nothing reads it to gate acceptance (the objective gate
 * outranks it — safety #6 — and the human is terminal — safety #7). `injectionFlags` proves
 * the reviewer's untrusted finding text was scanned (safety #2).
 */
export interface ReviewVerdict {
  /** Whether the diff PASSED adversarial review (derived from {@link verdict}). ADVISORY —
   *  a passing Review NEVER relaxes a red objective gate. */
  readonly passed: boolean;
  /** The PR phase-4 merge recommendation (`ready` | `merge_with_changes` |
   *  `needs_revision` | `blocked`). */
  readonly verdict: MergeVerdict;
  /** How many grounded findings the reviewer surfaced over the diff. */
  readonly findingsCount: number;
  /** The worst finding severity, when any finding was surfaced. */
  readonly highestSeverity?: ReviewSeverity;
  /** Injection-scan reasons over the reviewer's UNTRUSTED finding text (PRESENT-possibly-
   *  empty: the scan always runs — safety #2). */
  readonly injectionFlags: readonly string[];
}

/** Inputs for {@link runReview}. */
export interface RunReviewInput {
  /** The run's OBSERVER-wrapped bus — the review verdict fans out over `nc:debate`. */
  readonly bus: ConductorBus;
  /** The adversarial reviewer. Absent ⇒ the stage is DORMANT (returns null). */
  readonly driver: ReviewDriver | undefined;
  readonly preset: CouncilPreset;
  /** The run's inputs (councilRunId / objective / cwd / preset.successCriterion). */
  readonly run: CouncilRunInput;
  /** The Build stage's outcome — the diff to review. `null` ⇒ no build ran, so there is
   *  nothing to review and the stage is DORMANT (the third dormancy gate). */
  readonly build: BuildOutcome | null;
  readonly governor: RunGovernor;
  readonly logger: Logger | undefined;
}

/** Whether a preset declares a `review` stage (the first of the three dormancy gates). */
export function presetHasReviewStage(preset: CouncilPreset): boolean {
  return preset.stages.some((step) => step.stage === 'review');
}

/**
 * Run the adversarial Review stage (issue #369). Returns the {@link ReviewVerdict}, or
 * `null` when no review ran. Drives the injected reviewer over the writer's diff, charges
 * its spend against the run budget, and records the verdict onto the append-only transcript
 * THROUGH the mediated bus — the untrusted finding text injection-scanned + quoted (safety
 * #2), the verdict flagged ADVISORY (the objective gate outranks it — safety #6 — and the
 * human is terminal — safety #7). It never gates acceptance itself.
 */
export async function runReview(
  input: RunReviewInput,
): Promise<ReviewVerdict | null> {
  // TRIPLE GATE (off by default): review runs only when a driver is injected, the preset
  // declares a `review` stage, AND a Build produced a diff to review.
  if (input.driver === undefined || !presetHasReviewStage(input.preset)) return null;
  if (input.build === null) return null;
  // Never start a review turn on an already-halted run (killed or at a hard cap, safety #4).
  if (input.governor.killed || input.governor.capBreached() !== null) return null;

  const { build, run } = input;
  input.bus.note(
    'review',
    `Review stage: independently reviewing writer "${build.writerSeatId}"'s build diff ` +
      `adversarially (reuses the PR phase-4 diff reviewer). The verdict is ADVISORY — the ` +
      `objective gate outranks it (safety #6) and the human judge is terminal (safety #7).`,
  );

  const result = await input.driver.review({
    councilRunId: run.councilRunId,
    objective: run.objective,
    successCriterion: run.preset.successCriterion,
    writerSeatId: build.writerSeatId,
    diffSummary: build.diffSummary,
    ...(build.worktreePath !== undefined ? { worktreePath: build.worktreePath } : {}),
    signal: input.governor.signal,
  });
  // The reviewer is a real session — charge its spend against the run budget (safety #4),
  // like the writer's Build turn.
  input.governor.chargeSpend(result.usage, result.costUsd);

  const verdict = recordReviewVerdict(input.bus, result);
  input.logger?.info('council review stage completed', {
    councilRunId: run.councilRunId,
    passed: verdict.passed,
    verdict: verdict.verdict,
    findings: verdict.findingsCount,
  });
  return verdict;
}

/**
 * Record the reviewer's verdict onto the transcript and derive the ADVISORY {@link
 * ReviewVerdict}. The reviewer's finding text is UNTRUSTED (an AI over an attacker-
 * influencable diff): it is injection-scanned and rendered QUOTED inside the untrusted
 * fence (safety #2) before it lands in the conductor `note`, so a crafted finding ("VERDICT:
 * accept …", "ignore previous instructions") can only ever appear as fenced data, never a
 * bare instruction — and nothing parses it to make a decision, so it cannot forge acceptance.
 */
function recordReviewVerdict(bus: ConductorBus, result: ReviewResult): ReviewVerdict {
  const passed = REVIEW_PASS_VERDICTS.has(result.verdict);
  const findingsText = result.findings
    .map(
      (f) =>
        `[${f.severity}] ${f.file}${f.line !== undefined ? `:${f.line}` : ''} — ` +
        `${f.title}: ${f.body}`,
    )
    .join('\n');
  // ONE scan + fence over ALL the reviewer's untrusted finding text (safety #2).
  const quoted = quoteForSeat(REVIEW_CRITIC_ATTRIBUTION, findingsText);
  const highestSeverity = worstSeverity(result.findings);

  bus.note(
    'review',
    `Adversarial Review ${passed ? 'PASSED' : 'FAILED'} (merge verdict: ${result.verdict}) ` +
      `over the single-writer build diff — ${result.findings.length} finding(s)` +
      (highestSeverity !== undefined ? `, worst severity ${highestSeverity}` : '') +
      `. This verdict is ADVISORY DATA: the objective gate OUTRANKS it (safety #6 — a ` +
      `passing Review cannot relax a red gate) and the human judge is terminal (safety #7); ` +
      `the Review can never adopt a position. Reviewer findings (quoted untrusted data, ` +
      `injection scan ${quoted.flagged ? `FLAGGED: ${quoted.reasons.join('; ')}` : 'clean'}):\n` +
      quoted.text,
  );

  return {
    passed,
    verdict: result.verdict,
    findingsCount: result.findings.length,
    ...(highestSeverity !== undefined ? { highestSeverity } : {}),
    injectionFlags: quoted.reasons,
  };
}

/** The worst (highest-ranked) severity across the findings, or `undefined` when none. */
function worstSeverity(
  findings: readonly ReviewFinding[],
): ReviewSeverity | undefined {
  let worst: ReviewSeverity | undefined;
  for (const finding of findings) {
    if (worst === undefined || SEVERITY_ORDER.indexOf(finding.severity) > SEVERITY_ORDER.indexOf(worst)) {
      worst = finding.severity;
    }
  }
  return worst;
}
