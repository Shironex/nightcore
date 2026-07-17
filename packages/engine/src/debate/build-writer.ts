/**
 * The Council single-writer BUILD seam (issue #366, P2 — safety non-negotiable #5:
 * single-writer builds on isolated worktrees).
 *
 * This is the FIRST time a council WRITES code, not just reasons — the most
 * safety-critical seam in the debate engine — so it is built to REUSE the existing
 * confinement machinery, never to invent a new exec or write path:
 *
 *  - **Exactly one writer.** {@link electWriter} is the CONDUCTOR's election — a seat is
 *    NEVER self-appointed (safety #1, the injection firewall). The elected writer is the
 *    ONLY session in the whole run permitted to touch files.
 *  - **Write-capable but still confined.** Debating seats run READ-ONLY
 *    ({@link import('./session-seat-driver.js').SEAT_SESSION_HARDENING} = `plan` +
 *    sandbox). The writer must EDIT, so it runs at {@link BUILD_WRITER_HARDENING} —
 *    write-capable autonomy (`auto-accept`, deliberately NOT `bypass`) with the OS write
 *    sandbox STILL active (safety #3). The elevation is explicit, single-writer-only, and
 *    keeps the compensating control on.
 *  - **Isolated worktree, reused not reinvented.** The engine is EXEC-AGNOSTIC here,
 *    exactly like {@link import('./objective-gate.js').ObjectiveGate}: it never spawns a
 *    process or creates a worktree. A {@link BuildDriver} maps `context → result`; how the
 *    result is produced lives behind the seam, so the whole Build stage + its safety
 *    invariants are drivable with a deterministic FAKE driver in tests — no live worktree,
 *    no live session — as the rest of the council suite proves safety with fake seats.
 *
 * PRODUCTION CONTRACT (wired by the Build-capable preset slices #367/#368, NOT this
 * slice — see {@link BuildDriver}): the real driver allocates an isolated worktree via the
 * existing `apps/desktop/src-tauri/src/worktree/` module, runs the writer session inside
 * it at {@link BUILD_WRITER_HARDENING}, and routes every tool call through the SAME
 * confinement chokepoint a board task uses — the PreToolUse workspace-confinement gate,
 * `platform::git_command` isolation, the `CommitLease` single-flight, and the Seatbelt
 * sandbox. No new exec sink is introduced.
 */
import type { AutonomyLevel, TokenUsage } from '@nightcore/contracts';

import type { SeatContext } from './conductor-types.js';

/**
 * The single-writer session posture (safety #5 + #3). The ONE write-capable posture in a
 * council, applied to EXACTLY ONE elected seat:
 *
 *  - `autonomy: 'auto-accept'` — write-capable (the SDK `acceptEdits` mode): the writer
 *    may edit/write to implement the converged plan WITHOUT a per-tool human approval
 *    (there is no human in the loop mid-Build, so `auto-accept` is correct where `ask`
 *    would hang). It is deliberately NOT `bypass`: the governance tier stays on, so the
 *    OS sandbox remains the compensating control.
 *  - `sandboxWrites: true` — the OS write sandbox (Seatbelt) STAYS active on the writer
 *    (safety #3), containing every write to the isolated worktree. Elevation to write does
 *    NOT remove containment; it only lifts the read-only `plan` denial.
 *
 * Contrast {@link import('./session-seat-driver.js').SEAT_SESSION_HARDENING} (`plan` +
 * sandbox — read-only): a DEBATING seat can never write. Only the writer's session, at
 * this posture, in its own worktree, can.
 */
export const BUILD_WRITER_HARDENING: {
  readonly autonomy: AutonomyLevel;
  readonly sandboxWrites: boolean;
} = { autonomy: 'auto-accept', sandboxWrites: true };

/**
 * Elect the SINGLE writer for the Build stage (safety #5 + #1). The election is the
 * CONDUCTOR's — a seat cannot self-appoint — and deterministic: the first `proposer` seat
 * (proposers author solutions; a critic critiques and a judge rules), falling back to the
 * first seat when no proposer exists. Returns `null` for an empty council (no writer can
 * be elected → the Build stage is skipped). EXACTLY one seat is ever returned, so no
 * second seat can be handed the write-capable posture.
 */
export function electWriter(seats: readonly SeatContext[]): SeatContext | null {
  if (seats.length === 0) return null;
  return seats.find((seat) => seat.role === 'proposer') ?? seats[0]!;
}

/**
 * What the Conductor hands the single writer at Build. The `plan` is the debated positions
 * ALREADY run through the mediated, quoted, injection-scanned delivery path (safety #2) —
 * the writer implements it as the council's converged intent, never as a raw instruction.
 */
export interface BuildContext {
  readonly councilRunId: string;
  readonly objective: string;
  /** The single elected writer (conductor-mediated — safety #1). */
  readonly writer: SeatContext;
  /** The converged plan, as mediated quoted+scanned text (safety #2). */
  readonly plan: string;
  /** The run's project root. The production driver allocates the ISOLATED worktree under
   *  it (`<project>/.nightcore/worktrees/…`) and runs the writer with cwd = that worktree.
   *  Absent ⇒ the process cwd. */
  readonly cwd?: string;
  /** Aborts on kill/budget (safety #4) so the writer session is torn down. */
  readonly signal: AbortSignal;
}

/** What the single writer's Build turn produced. */
export interface BuildResult {
  /** The writer's output — a diff/change summary recorded onto the transcript. */
  readonly content: string;
  /** Token usage for the writer turn (charged against `budget.maxTotalTokens`). */
  readonly usage: TokenUsage;
  /** Cost in USD for the writer turn (charged against `budget.maxCostUsd`). */
  readonly costUsd: number;
  /** The isolated worktree the writer built in — the directory the objective gate (#365)
   *  runs its deterministic build/test check in, so the gate judges the BUILD OUTPUT (not
   *  the plan). Absent ⇒ the driver ran in the run cwd (a degraded/fake driver). */
  readonly worktreePath?: string;
}

/**
 * The provider/exec-neutral seam the Conductor drives the single writer through. ONE
 * method: run the writer's Build turn on an isolated worktree and return its result. The
 * engine NEVER creates a worktree or spawns a process here — that is the injected
 * implementation's job (a Rust-backed driver in production, a deterministic fake in
 * tests), mirroring {@link import('./objective-gate.js').ObjectiveGate}.
 *
 * PRODUCTION CONTRACT (wired by the Build-capable preset slices #367/#368, NOT this
 * slice): a production driver MUST
 *  1. allocate an isolated worktree via `crate::worktree::allocate` (REUSE — never
 *     reimplement worktree handling), run the writer session with `cwd` = that worktree,
 *     then merge or discard it via `crate::worktree::{merge_branch,remove}`;
 *  2. spawn the writer session at {@link BUILD_WRITER_HARDENING} (write-capable +
 *     sandboxed) and route every tool call through the SAME PreToolUse
 *     workspace-confinement gate + `platform::git_command` isolation + `CommitLease`
 *     single-flight a board task uses — no new exec sink;
 *  3. keep the writer the ONLY session that writes (safety #5).
 * Until such a driver is injected, the Build stage stays DORMANT (see the Conductor).
 */
export interface BuildDriver {
  build(context: BuildContext): Promise<BuildResult>;
}
