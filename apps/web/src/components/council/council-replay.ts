/**
 * Read-only Council REPLAY fold (issue #354, safety non-negotiable #7).
 *
 * A finished run's append-only transcript (the `nc:debate` entries the canvas already
 * captured) can be reconstructed by re-driving the canvas from it in order. This module
 * is the PURE primitive behind that: given the full transcript and a playback `cursor`,
 * it returns the `seq`-ordered PREFIX revealed so far. It re-renders recorded entries —
 * it NEVER re-dispatches a seat, resends a command, or emits anything live (it imports
 * no bridge command, so it is read-only by construction). Deduped + ordered by the
 * store-assigned `seq`, mirroring `foldCouncilTranscript` / `groupReplyRounds`, so the
 * reconstruction is deterministic regardless of wire delivery order.
 */
import type { DebateTranscriptEntry } from '@/lib/bridge';

/** The transcript entries deduped by their store-assigned `seq` and ordered ascending —
 *  the exact sequence a replay walks (safety #7). */
export function orderReplayEntries(
  entries: readonly DebateTranscriptEntry[],
): DebateTranscriptEntry[] {
  const bySeq = new Map<number, DebateTranscriptEntry>();
  for (const entry of entries) bySeq.set(entry.seq, entry);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** How many distinct entries a run's transcript replays to (the cursor's upper bound). */
export function replayTotal(entries: readonly DebateTranscriptEntry[]): number {
  return orderReplayEntries(entries).length;
}

/**
 * The ordered prefix of the first `cursor` entries — what the canvas shows at this
 * point in the replay. `cursor` is clamped to `[0, total]`, so a `0` cursor reveals
 * nothing and a full cursor reproduces the entire run in exact order. Pure: it never
 * mutates its input.
 */
export function replayFrames(
  entries: readonly DebateTranscriptEntry[],
  cursor: number,
): DebateTranscriptEntry[] {
  const ordered = orderReplayEntries(entries);
  const clamped = Math.max(0, Math.min(Math.floor(cursor), ordered.length));
  return ordered.slice(0, clamped);
}
