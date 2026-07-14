import { describe, expect, test } from 'vitest';

import type { DebateTranscriptEntry } from '@/lib/bridge';

import { orderReplayEntries, replayFrames, replayTotal } from './council-replay';

/** A minimal transcript entry at `seq` with greppable content. */
function entry(seq: number, content = `entry-${seq}`): DebateTranscriptEntry {
  return {
    stage: 'propose',
    seatId: `s-${seq}`,
    role: 'proposer',
    kind: 'message',
    seq,
    content,
    at: seq,
  };
}

describe('council-replay (safety #7: read-only reconstruction from the transcript)', () => {
  test('orders entries by seq and dedupes a re-delivered wire event', () => {
    const out = orderReplayEntries([entry(2), entry(0), entry(1), entry(0)]);
    expect(out.map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  test('a full cursor reproduces the entire run in exact order', () => {
    const src = [entry(0), entry(1), entry(2)];
    const full = replayFrames(src, replayTotal(src));
    expect(full.map((e) => e.content)).toEqual(['entry-0', 'entry-1', 'entry-2']);
  });

  test('the cursor reveals a growing ordered prefix, clamped to [0, total]', () => {
    const src = [entry(0), entry(1), entry(2)];
    expect(replayFrames(src, 0)).toHaveLength(0);
    expect(replayFrames(src, 1).map((e) => e.seq)).toEqual([0]);
    expect(replayFrames(src, 2).map((e) => e.seq)).toEqual([0, 1]);
    // Over-run clamps to the full transcript; a negative cursor clamps to empty.
    expect(replayFrames(src, 99).map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(replayFrames(src, -5)).toHaveLength(0);
  });

  test('is pure — it never mutates its input', () => {
    const src = [entry(1), entry(0)];
    const snapshot = [...src];
    replayFrames(src, 1);
    orderReplayEntries(src);
    expect(src).toEqual(snapshot);
  });
});
