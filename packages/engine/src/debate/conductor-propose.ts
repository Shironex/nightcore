/**
 * The Council PROPOSE stage (issue #350) — split out of `conductor.ts` so the state
 * machine stays under the engine file-size cap, mirroring `debate-round.ts` /
 * `conductor-converge.ts` / `conductor-build.ts`.
 *
 * Propose is BLIND + parallel: each seat answers the objective ALONE (no peer content
 * enters a Propose prompt), so diversity survives into Debate. Seats dispatch through the
 * broadcast collector — bounded concurrency, a per-seat timeout so a hung seat can't stall
 * the stage, and a pre-dispatch budget reservation so a parallel Propose can't overshoot
 * the caps (#351, LOW-A). Each responder's proposal is recorded onto the mediated bus; a
 * timed-out seat contributes none. The stage drives seats through the provider-neutral
 * {@link import('./conductor-types.js').SeatDriver} seam via the injected `runTurn`, so it
 * is unit-tested with deterministic fake seats.
 */
import { collectBroadcast } from './broadcast-collector.js';
import type { ConductorBus } from './bus.js';
import type { RunGovernor } from './conductor-budget.js';
import type {
  SeatContext,
  SeatTurnResult,
  TurnEstimate,
} from './conductor-types.js';

/** The seams the Propose stage drives. `bus` is the OBSERVING conductor bus; `runTurn`
 *  wraps the {@link import('./conductor-types.js').SeatDriver}. */
export interface ProposeStageHooks {
  readonly bus: ConductorBus;
  readonly seats: readonly SeatContext[];
  readonly governor: RunGovernor;
  /** Bounded-concurrency + timeout + reservation config for the parallel broadcast. */
  readonly dispatch: {
    maxConcurrency?: number;
    timeoutMs?: number;
    estimate: TurnEstimate;
  };
  /** Build a seat's blind Propose prompt (objective + role only — never peer content). */
  buildPrompt(seat: SeatContext): string;
  /** Drive one seat turn through the {@link import('./conductor-types.js').SeatDriver}
   *  seam, threading the collector's per-seat abort `signal`. */
  runTurn(
    seat: SeatContext,
    prompt: string,
    signal: AbortSignal,
  ): Promise<SeatTurnResult>;
}

/**
 * Run the blind, parallel Propose stage: broadcast the independent-answer prompt, collect
 * each seat's proposal through the bounded collector, record each onto the mediated bus,
 * and return the proposals keyed by seat id (a timed-out seat contributes none).
 */
export async function runProposeStage(
  hooks: ProposeStageHooks,
): Promise<Map<string, string>> {
  const { bus, seats, governor } = hooks;
  const { broadcastId } = bus.broadcast(
    'propose',
    'Propose your best answer independently. You cannot see other seats yet.',
  );

  const broadcast = await collectBroadcast<SeatContext>({
    broadcastId,
    seats,
    governor,
    ...hooks.dispatch,
    signal: governor.signal,
    run: (seat, dispatch) =>
      hooks.runTurn(seat, hooks.buildPrompt(seat), dispatch.signal),
  });

  const outputs = new Map<string, string>();
  for (const outcome of broadcast.responders) {
    const content = outcome.result?.content ?? '';
    bus.postSeatMessage({
      stage: 'propose',
      seatId: outcome.seat.seatId,
      role: outcome.seat.role,
      content,
      broadcastId,
    });
    outputs.set(outcome.seat.seatId, content);
  }
  return outputs;
}
