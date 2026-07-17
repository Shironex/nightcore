/**
 * The Council preset registry (issue #349) — the engine half of preset-as-data.
 *
 * `@nightcore/contracts` owns the `CouncilPresetId` enum (the shared cross-tier
 * vocabulary, force-emitted to Rust); this module owns the concrete preset VALUES,
 * exactly as `providers/claude/kind-presets.ts` owns the agent definition for each
 * `TaskKind`. A preset is looked up by its typed id via {@link resolveCouncilPreset}.
 *
 * The registry is a TOTAL map keyed by `CouncilPresetId`, so adding a preset id to
 * the contract enum forces a registry entry here — the type checker is the parity
 * guard. P1 shipped {@link RESEARCH_COUNCIL_PRESET}; P2 adds the reproduce-first
 * {@link UI_BUG_COUNCIL_PRESET} (#367) and the debate-the-plan
 * {@link CODING_COUNCIL_PRESET} (#368).
 *
 * The preset values here are DATA only; the P1 invariants (`≤4` seats, `≥2` distinct
 * models, positive caps) are enforced by `validateCouncilPreset` — see the tests,
 * which assert every registered preset validates.
 */
import type { CouncilPreset, CouncilPresetId } from '@nightcore/contracts';

/**
 * The P1 **Research** council: a governed debate that produces a synthesized
 * recommendation with cited tradeoffs for a human to accept.
 *
 * - **Seats** — two proposers on DISTINCT models (heterogeneity is the point) plus a
 *   critic; three seats, two distinct models, well under the `≤4` cap.
 * - **Stages** — `Frame → Propose(blind) → Debate(≤2) → Converge(human)`. Propose is
 *   blind (parallel, unaware of each other) so diversity survives into the debate;
 *   Debate loops at most twice; the human is the terminal judge.
 * - **Routing** — the conductor-`moderated-bus`, no peer edges (safety #1).
 * - **Budget** — hard caps the conductor's kill/early-stop enforces (safety #4).
 */
export const RESEARCH_COUNCIL_PRESET: CouncilPreset = {
  id: 'research',
  label: 'Research council',
  seats: [
    { id: 'proposer-opus', role: 'proposer', model: 'claude-opus-4-8' },
    { id: 'proposer-sonnet', role: 'proposer', model: 'claude-sonnet-4-6' },
    { id: 'critic-opus', role: 'critic', model: 'claude-opus-4-8' },
  ],
  stages: [
    { stage: 'frame', blind: false },
    { stage: 'propose', blind: true },
    { stage: 'debate', blind: false, maxRounds: 2 },
    { stage: 'converge', blind: false },
  ],
  routing: { mode: 'moderated-bus', edges: [] },
  successCriterion:
    'A synthesized recommendation with explicit, cited tradeoffs that the human judge accepts.',
  convergence: 'human',
  budget: { maxRounds: 2, maxTotalTokens: 400_000, maxCostUsd: 5 },
};

/**
 * The P2 **UI-bug** council (issue #367): a REPRODUCE-FIRST debate whose objective gate is
 * a repro that must go RED → GREEN. The gate — not the debate — decides success.
 *
 * - **Reproduce-first** — the council first establishes a RED repro (a failing check that
 *   proves it understood the bug), then the single-writer Build turns it GREEN. The
 *   `objectiveGate: 'repro'` gate runs over the build output at Converge and is the terminal
 *   judge: a still-RED repro cannot be adopted over a confident debate consensus (safety #6).
 * - **Seats** — two proposers on DISTINCT models plus a critic (three seats, two distinct
 *   models, under the `≤4` cap). The Build's single writer is elected from the proposers
 *   (`electWriter`), never the critic — so the reproduce-first fix has one author.
 * - **Stages** — `Frame → Propose(blind) → Debate(≤2) → Build → Converge`. The `build` stage
 *   is where the fix that flips the repro is written (DORMANT until a `BuildDriver` is
 *   injected — see `objective-preset.ts`); the gate judges its output.
 * - **Routing / Budget** — the conductor-`moderated-bus` (safety #1); hard caps (safety #4).
 */
export const UI_BUG_COUNCIL_PRESET: CouncilPreset = {
  id: 'ui-bug',
  label: 'UI-bug council',
  seats: [
    { id: 'proposer-opus', role: 'proposer', model: 'claude-opus-4-8' },
    { id: 'proposer-sonnet', role: 'proposer', model: 'claude-sonnet-4-6' },
    { id: 'critic-opus', role: 'critic', model: 'claude-opus-4-8' },
  ],
  stages: [
    { stage: 'frame', blind: false },
    { stage: 'propose', blind: true },
    { stage: 'debate', blind: false, maxRounds: 2 },
    { stage: 'build', blind: false },
    { stage: 'converge', blind: false },
  ],
  routing: { mode: 'moderated-bus', edges: [] },
  successCriterion:
    'A repro (a failing check that reproduces the bug) that the Build turns from RED to ' +
    'GREEN — the objective gate, not the debate, decides success.',
  convergence: 'human',
  objectiveGate: 'repro',
  budget: { maxRounds: 2, maxTotalTokens: 500_000, maxCostUsd: 6 },
};

/**
 * The P2 **Coding** council (issue #368): the council debates the implementation PLAN
 * ONLY — approach, tradeoffs, risks — never keystrokes. The debate's output is a plan, not
 * code; the single-writer Build executes it and a build/test gate decides success.
 *
 * - **Debate the plan, never keystrokes** — the seats reason about HOW to implement the
 *   objective (a plan), and the debate converges on one. Only the elected writer's Build
 *   session ever types code — structurally, the seats run read-only/plan and the writer is
 *   the sole write-capable session (safety #5/#1). "Execution, not reasoning — debate
 *   plans, it never types keystrokes."
 * - **`build` build/test gate is terminal** — after the Build executes the converged plan,
 *   the `objectiveGate: 'build'` gate runs a typecheck/lint/test gauntlet over the writer's
 *   worktree. A RED build/test cannot be adopted over debate consensus (safety #6): the
 *   gate, not the debate, decides success.
 * - **Seats** — two proposers on DISTINCT models plus a critic (three seats, two distinct
 *   models, under the `≤4` cap). The Build's single writer is elected from the proposers
 *   (`electWriter` over the debaters), never the critic — the plan has one implementer.
 * - **Stages** — `Frame → Propose(blind) → Debate(≤2) → Build → Converge`. The `build` stage
 *   is where the converged plan is executed (DORMANT until a `BuildDriver` is injected — the
 *   real write-capable driver is a tracked follow-up, see `objective-preset.ts`); the gate
 *   judges its output.
 * - **Routing / Budget** — the conductor-`moderated-bus` (safety #1); hard caps (safety #4).
 */
export const CODING_COUNCIL_PRESET: CouncilPreset = {
  id: 'coding',
  label: 'Coding council',
  seats: [
    { id: 'proposer-opus', role: 'proposer', model: 'claude-opus-4-8' },
    { id: 'proposer-sonnet', role: 'proposer', model: 'claude-sonnet-4-6' },
    { id: 'critic-opus', role: 'critic', model: 'claude-opus-4-8' },
  ],
  stages: [
    { stage: 'frame', blind: false },
    { stage: 'propose', blind: true },
    { stage: 'debate', blind: false, maxRounds: 2 },
    { stage: 'build', blind: false },
    { stage: 'converge', blind: false },
  ],
  routing: { mode: 'moderated-bus', edges: [] },
  successCriterion:
    'A converged implementation plan the single-writer Build executes, whose build/test ' +
    'gate (typecheck/lint/test) passes — the gate, not the debate, decides success.',
  convergence: 'human',
  objectiveGate: 'build',
  budget: { maxRounds: 2, maxTotalTokens: 500_000, maxCostUsd: 6 },
};

/** Every council preset, keyed by its id. Total over `CouncilPresetId`, so a new
 *  preset id fails to type-check until a value is registered here. */
export const COUNCIL_PRESETS: Readonly<Record<CouncilPresetId, CouncilPreset>> =
  Object.freeze({
    research: RESEARCH_COUNCIL_PRESET,
    'ui-bug': UI_BUG_COUNCIL_PRESET,
    coding: CODING_COUNCIL_PRESET,
  });

/** Resolve a council preset by its typed id. Total: every `CouncilPresetId` has a
 *  registered preset (the type checker enforces it), so this never returns
 *  `undefined`. */
export function resolveCouncilPreset(id: CouncilPresetId): CouncilPreset {
  return COUNCIL_PRESETS[id];
}
