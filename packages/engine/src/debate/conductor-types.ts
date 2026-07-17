/**
 * The Conductor's seams and result shapes (issue #350).
 *
 * The Conductor is an ORCHESTRATOR, never a peer: it owns turn-taking, routing, and
 * convergence for one council run and holds the sole {@link ConductorBus} write
 * handle. It has ZERO agent-to-agent command authority — that absence IS the
 * injection firewall (safety non-negotiable #1). A seat is driven ONLY through the
 * provider-neutral {@link SeatDriver} seam below; the Conductor never lets one seat
 * write into another's context (every cross-seat relay goes through the mediated,
 * quoted, injection-scanned {@link ConductorBus.deliverBetweenSeats}, funneled by
 * `peer-context.ts`).
 *
 * The seam is deliberately narrow so the whole state machine + its safety invariants
 * are unit-testable with deterministic FAKE seats — no live provider call. The
 * production seam is `session-seat-driver.ts`.
 */
import type {
  CouncilConvergeDecision,
  CouncilSeat,
  DebateSeatRole,
  DebateStage,
  DebateTranscriptEntry,
  TokenUsage,
} from '@nightcore/contracts';

import type { ReviewVerdict } from './conductor-review.js';
import type { ObjectiveGateVerdict } from './objective-gate.js';
import type { CouncilPresetIssue } from './preset-validator.js';

/**
 * A seat's read-only context handed to the {@link SeatDriver}. `view` is the
 * READ-ONLY {@link import('./bus.js').SeatBusView} — a seat can observe the moderated
 * transcript but has no method to write it (safety #1). `id` is SYSTEM-MINTED by the
 * Conductor from the preset, never agent-supplied (safety LOW: the id is interpolated
 * into the quote fence tag).
 */
export interface SeatContext {
  readonly seatId: string;
  readonly role: DebateSeatRole;
  readonly model: string;
}

/** One turn the Conductor asks a seat to take. `prompt` is fully assembled by the
 *  Conductor — for a Debate turn it contains ONLY quoted+scanned peer content (never
 *  raw peer output). `signal` aborts on kill/budget so a cooperative driver bails. */
export interface SeatTurnRequest {
  readonly seat: SeatContext;
  readonly stage: DebateStage;
  readonly prompt: string;
  /** The run's working directory (a seat session's cwd). Absent ⇒ the process cwd. */
  readonly cwd?: string;
  /** Aborts when the run is killed or the budget is exhausted mid-flight. */
  readonly signal: AbortSignal;
}

/** What one seat turn produced: its text plus the spend to charge the run budget. */
export interface SeatTurnResult {
  /** The seat's output text. Recorded onto the bus as the seat's own `message`. */
  readonly content: string;
  /** Token usage for this turn (charged against `budget.maxTotalTokens`). */
  readonly usage: TokenUsage;
  /** Cost in USD for this turn (charged against `budget.maxCostUsd`). */
  readonly costUsd: number;
}

/**
 * A per-turn budget estimate the broadcast collector RESERVES against the {@link
 * import('./conductor-budget.js').RunGovernor} BEFORE it dispatches a seat, so a
 * bounded parallel broadcast cannot overshoot the hard caps by a whole round (issue
 * #351, carry-forward LOW-A). The reservation makes an in-flight turn visible to
 * concurrent cap checks; it is reconciled to the turn's ACTUAL spend the instant the
 * turn lands (or released if the turn is refused/timed-out and never charges).
 */
export interface TurnEstimate {
  readonly tokens: number;
  readonly costUsd: number;
}

/**
 * The provider-neutral seam the Conductor drives a seat through. ONE method: run a
 * turn and return its output. The Conductor owns the prompt (including the mediated
 * peer context) and the transcript; the driver only maps `prompt → output`. Fakes
 * implement this for the state-machine + safety tests; `SessionSeatDriver` implements
 * it over the real session path.
 */
export interface SeatDriver {
  runTurn(request: SeatTurnRequest): Promise<SeatTurnResult>;
}

/** How a council run terminated. */
export type CouncilRunStatus =
  /** Reached Converge and parked a decision for the human judge (the P1 happy path). */
  | 'converged'
  /** The kill switch halted the run (safety #4). */
  | 'killed'
  /** A hard budget/round cap halted the run (safety #4) — see `haltedBy`. */
  | 'budget-exhausted'
  /** The preset failed `validateCouncilPreset` at Frame — see `issues`. Nothing ran. */
  | 'invalid-preset'
  /** An unexpected error crashed the run (degrade-not-throw). */
  | 'failed';

/** Which hard cap tripped a `budget-exhausted` halt. */
export type BudgetHaltCause = 'maxRounds' | 'maxTotalTokens' | 'maxCostUsd';

/** One seat's final position, carried into the human judge's parked decision. Its
 *  `content` is the seat's OWN output (the seat authored it), quoted only when it is
 *  relayed to ANOTHER seat — a seat reading its own position back is not a cross-seat
 *  relay, so it is not fenced here. */
export interface SeatPosition {
  readonly seatId: string;
  readonly role: DebateSeatRole;
  readonly content: string;
}

/**
 * The parked Converge decision the HUMAN judge resolves (safety #7: the human is the
 * terminal authority). P1 has NO agent-judge and NO vote — the Conductor stops here
 * and surfaces the seats' final positions for a human to accept/reject. Wiring the
 * human's resolution to the InteractionDock is the canvas slice (#352); this slice
 * produces the decision to be resolved.
 */
export interface PendingConvergeDecision {
  readonly councilRunId: string;
  /** The success criterion the human weighs the positions against. */
  readonly successCriterion: string;
  /** Each seat's final position, side-by-side (disagreement is the product). */
  readonly positions: readonly SeatPosition[];
  /**
   * The objective gate's verdict, when the run ran one at Converge (issue #365, safety
   * #6). Absent ⇒ no objective gate (a pure-reasoning task; the human decides alone). A
   * PRESENT-and-failed verdict OVERRIDES debate consensus: a plain `accept` is refused
   * unless the human explicitly overrides the gate — the gate is the DEFAULT terminal
   * judge for objective tasks (see {@link ConvergeDecision.overrideGate}).
   */
  readonly gateVerdict?: ObjectiveGateVerdict;
  /**
   * The adversarial Review verdict, when a Review ran over the Build's diff (issue #369,
   * P2). Absent ⇒ no review (a pure-reasoning run, no build, or a dormant reviewer). It is
   * ADVISORY DATA surfaced beside {@link gateVerdict} so the human weighs both: it does NOT
   * gate acceptance and does NOT relax the objective gate (safety #6 — the gate outranks
   * it), and the human remains terminal (safety #7). Its finding text was injection-scanned
   * (safety #2) — see {@link ReviewVerdict.injectionFlags}.
   */
  readonly reviewVerdict?: ReviewVerdict;
}

/** Running spend totals for a council run. */
export interface CouncilRunUsage {
  readonly totalTokens: number;
  readonly costUsd: number;
  /** Debate rounds actually executed (0 if the run halted before Debate). */
  readonly rounds: number;
}

/**
 * The terminal outcome of a council run. The full append-only transcript is always
 * returned (auditable + replayable — safety #7), regardless of status.
 */
export interface CouncilRunResult {
  readonly councilRunId: string;
  readonly status: CouncilRunStatus;
  readonly transcript: readonly DebateTranscriptEntry[];
  readonly usage: CouncilRunUsage;
  /** Present when `status === 'converged'`: the decision parked for the human judge. */
  readonly pendingDecision?: PendingConvergeDecision;
  /** Present when `status === 'invalid-preset'`: why the preset was rejected. */
  readonly issues?: readonly CouncilPresetIssue[];
  /** Present when `status === 'budget-exhausted'`: which cap tripped. */
  readonly haltedBy?: BudgetHaltCause;
}

/** The seats a run drives, in preset order. */
export type CouncilSeatList = readonly CouncilSeat[];

/**
 * The human judge's Converge verdict the Conductor resolves a parked run with (issue
 * #353, safety #7). P1 Converge is HUMAN-only. `kind` is the verdict; `seatId` names
 * the adopted seat for an `accept` (must be one of the parked positions); `note` is the
 * ruling for a `judge` (or optional reason for accept/reject). Mirrors the
 * `resolve-council-converge` command contract.
 */
export interface ConvergeDecision {
  readonly kind: CouncilConvergeDecision;
  readonly seatId?: string;
  readonly note?: string;
  /**
   * The human's EXPLICIT override of a failing objective gate (issue #365, safety #6).
   * When the parked decision's {@link PendingConvergeDecision.gateVerdict} is red, an
   * `accept` (adopting a seat's debated position) is REFUSED unless this is `true` — the
   * objective gate outranks the debate by default, and only the human's deliberate
   * override supersedes it (the human is the ultimate authority, safety #7). Ignored for
   * `reject`/`judge` (neither adopts the debate's answer) and when the gate passed.
   */
  readonly overrideGate?: boolean;
}

/**
 * The outcome of resolving a parked Converge decision. `ok` is false (with a `reason`)
 * when the run has no parked decision (unknown / already resolved) or the verdict is
 * malformed for its kind (an `accept` without a valid seat, a `judge` without a
 * ruling); on success the recorded verdict `entry` and the closing `transcript` are
 * returned so the resolution is provably auditable (safety #7).
 */
export interface ConvergeResolution {
  readonly ok: boolean;
  /** Why the resolution was refused, when `ok` is false. */
  readonly reason?: string;
  /** The append-only verdict entry the Conductor recorded, when `ok` is true. */
  readonly entry?: DebateTranscriptEntry;
  /** The run's full closing transcript (verdict included), when `ok` is true. */
  readonly transcript?: readonly DebateTranscriptEntry[];
}
