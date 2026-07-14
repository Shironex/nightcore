/**
 * The Council REPLAY model (issue #354, safety #7). Owns the playback cursor + timer and
 * folds the finished run's transcript into the growing prefix the canvas re-renders.
 *
 * Read-only by construction: it imports the pure {@link replayFrames} fold and NO bridge
 * command — driving playback can never re-dispatch a seat or resend a live command. The
 * cursor walks the append-only entries in `seq` order; a full cursor reproduces the run.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { DebateTranscriptEntry } from '@/lib/bridge';

import type { CouncilTranscript } from '../council.types';
import { replayFrames, replayTotal } from '../council-replay';
import { foldCouncilTranscript } from '../council-transcript';

/** How long each recorded entry lingers before the next is revealed (ms). */
const STEP_INTERVAL_MS = 750;

export interface CouncilReplayModel {
  /** The seat nodes + team-chat folded from the revealed prefix — what the canvas
   *  renders this frame (a pure projection of the recorded entries). */
  folded: CouncilTranscript;
  /** How many entries are revealed (the scrubber value). */
  cursor: number;
  /** The total entry count (the scrubber max + the run's full length). */
  total: number;
  /** Whether playback is advancing. */
  playing: boolean;
  /** True once the whole run has been reconstructed. */
  atEnd: boolean;
  /** Toggle play/pause. Toggling play at the end restarts from the beginning. */
  toggle: () => void;
  /** Restart the reconstruction from the first entry and play. */
  restart: () => void;
  /** Jump the cursor to a specific point (the scrubber), pausing playback. */
  seek: (cursor: number) => void;
}

export function useCouncilReplay(
  transcript: DebateTranscriptEntry[],
): CouncilReplayModel {
  const total = useMemo(() => replayTotal(transcript), [transcript]);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(true);

  const atEnd = cursor >= total;

  // Advance one entry per tick while playing; stop at the end. A pure read-driven timer —
  // it only moves the cursor, never touches the bridge.
  useEffect(() => {
    if (!playing || atEnd) return;
    const id = setInterval(() => {
      setCursor((prev) => Math.min(prev + 1, total));
    }, STEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [playing, atEnd, total]);

  const toggle = useCallback(() => {
    setCursor((prev) => (prev >= total ? 0 : prev));
    setPlaying((prev) => !prev);
  }, [total]);

  const restart = useCallback(() => {
    setCursor(0);
    setPlaying(true);
  }, []);

  const seek = useCallback(
    (next: number) => {
      setPlaying(false);
      setCursor(Math.max(0, Math.min(Math.floor(next), total)));
    },
    [total],
  );

  const folded = useMemo(
    () => foldCouncilTranscript(replayFrames(transcript, cursor)),
    [transcript, cursor],
  );

  return {
    folded,
    cursor,
    total,
    playing,
    atEnd,
    toggle,
    restart,
    seek,
  };
}
