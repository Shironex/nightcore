/**
 * The Council Converge stage's PARK + human-gavel RESOLUTION (issue #353) — split out of
 * `conductor.ts` so the state machine stays under the engine file-size cap.
 *
 * P1's Converge is HUMAN-only (safety non-negotiable #7 — the human is the terminal
 * authority; no agent-judge, no vote). The Conductor drives the debate to Converge and
 * PARKS the seats' final positions here; the human later closes the run with a verdict.
 * The verdict is recorded onto the append-only transcript through the SAME
 * observer-wrapped {@link ConductorBus} every other entry uses — never a direct
 * transcript-store write from the surface (safety #1, the injection firewall) — which
 * also streams it over `nc:debate`. Clearing the park closes the run.
 */
import type { DebateTranscriptEntry } from '@nightcore/contracts';
import type { Logger } from '@nightcore/shared';

import type { ConductorBus } from './bus.js';
import type {
  ConvergeDecision,
  ConvergeResolution,
  PendingConvergeDecision,
  SeatContext,
} from './conductor-types.js';

/** A run parked at Converge, awaiting the human judge's verdict. Holds the run's
 *  OBSERVER-wrapped bus (so the verdict rides the audit + `nc:debate` fan-out every
 *  entry does) and the positions the human weighs (`accept` must name one). */
export interface ParkedConverge {
  readonly bus: ConductorBus;
  readonly pending: PendingConvergeDecision;
}

/** Inputs for {@link parkConverge}. */
export interface ParkConvergeInput {
  readonly parked: Map<string, ParkedConverge>;
  /** The run's OBSERVER-wrapped bus — kept so the eventual verdict fans out identically. */
  readonly bus: ConductorBus;
  readonly councilRunId: string;
  readonly seats: readonly SeatContext[];
  readonly finalOutputs: ReadonlyMap<string, string>;
  readonly successCriterion: string;
  readonly rounds: number;
}

/** Record the Converge note, build the seats' final positions, PARK the run for the
 *  human judge, and return the pending decision to surface on the run result. */
export function parkConverge(input: ParkConvergeInput): PendingConvergeDecision {
  const positions = input.seats.map((seat) => ({
    seatId: seat.seatId,
    role: seat.role,
    content: input.finalOutputs.get(seat.seatId) ?? '',
  }));

  input.bus.note(
    'converge',
    `Debate closed after ${input.rounds} round(s). ` +
      `Parking ${positions.length} final position(s) for the human judge.`,
  );

  const pending: PendingConvergeDecision = {
    councilRunId: input.councilRunId,
    successCriterion: input.successCriterion,
    positions,
  };
  input.parked.set(input.councilRunId, { bus: input.bus, pending });
  return pending;
}

/**
 * Resolve a run's PARKED Converge decision with the human judge's verdict. Records the
 * canonical verdict onto the append-only transcript through the run's mediated bus and
 * clears the park (closing the run). Idempotent: resolving an unknown / already-resolved
 * run is a refused no-op, and a malformed verdict (an `accept` naming no parked seat, a
 * `judge` with no ruling) is refused WITHOUT recording anything (the run stays parked).
 */
export function resolveParkedConverge(
  parked: Map<string, ParkedConverge>,
  councilRunId: string,
  decision: ConvergeDecision,
  readTranscript: () => readonly DebateTranscriptEntry[],
  logger?: Logger,
): ConvergeResolution {
  const entry = parked.get(councilRunId);
  if (entry === undefined) {
    return { ok: false, reason: 'no parked Converge decision for this run' };
  }

  const rendered = renderVerdict(decision, entry.pending);
  if (!rendered.ok) return { ok: false, reason: rendered.reason };

  const verdict = entry.bus.recordVerdict(rendered.content);
  parked.delete(councilRunId);
  logger?.info('council converge resolved by human judge', {
    councilRunId,
    decision: decision.kind,
  });
  return { ok: true, entry: verdict, transcript: readTranscript() };
}

/** Validate a verdict against the parked positions and render its canonical, auditable
 *  transcript content. Refuses an `accept` that names no parked seat and a `judge` with
 *  no ruling — the two verdicts that carry required data. */
function renderVerdict(
  decision: ConvergeDecision,
  pending: PendingConvergeDecision,
): { ok: true; content: string } | { ok: false; reason: string } {
  const note = decision.note?.trim();
  switch (decision.kind) {
    case 'accept': {
      const position = pending.positions.find((p) => p.seatId === decision.seatId);
      if (position === undefined) {
        return {
          ok: false,
          reason: `accept names an unknown seat "${decision.seatId ?? ''}"`,
        };
      }
      return {
        ok: true,
        content:
          `Human verdict — ACCEPT: adopted seat "${position.seatId}" (${position.role}).` +
          (note ? ` Reason: ${note}` : ''),
      };
    }
    case 'reject':
      return {
        ok: true,
        content:
          'Human verdict — REJECT: no position adopted.' +
          (note ? ` Reason: ${note}` : ''),
      };
    case 'judge':
      if (note === undefined || note.length === 0) {
        return { ok: false, reason: 'judge requires a ruling note' };
      }
      return { ok: true, content: `Human verdict — RULING: ${note}` };
  }
}
