import { expect, test } from 'vitest';

import type { DebateTranscriptEntry } from '@/lib/bridge';

import { groupReplyRounds } from './reply-diff';

/** Build a transcript entry with sensible defaults for the fields a test doesn't set. */
function entry(over: Partial<DebateTranscriptEntry> & { seq: number }): DebateTranscriptEntry {
  return {
    stage: 'propose',
    seatId: 'proposer-1',
    role: 'proposer',
    kind: 'message',
    content: 'a reply',
    at: 1_000 + over.seq,
    ...over,
  };
}

test('groups the N seat replies of one broadcast into a single side-by-side round', () => {
  const rounds = groupReplyRounds([
    entry({ seq: 0, seatId: 'conductor', role: 'conductor', kind: 'broadcast', broadcastId: 'bc-0', content: 'propose' }),
    entry({ seq: 1, seatId: 'proposer-1', role: 'proposer', broadcastId: 'bc-0', content: 'Plan A' }),
    entry({ seq: 2, seatId: 'critic-1', role: 'critic', broadcastId: 'bc-0', content: 'Plan B' }),
    entry({ seq: 3, seatId: 'proposer-2', role: 'proposer', broadcastId: 'bc-0', content: 'Plan C' }),
  ]);

  expect(rounds).toHaveLength(1);
  const [propose] = rounds;
  expect(propose?.label).toBe('Propose');
  // N replies side-by-side, in seat order — disagreement is NOT collapsed.
  expect(propose?.columns.map((c) => c.seatId)).toEqual(['proposer-1', 'critic-1', 'proposer-2']);
  expect(propose?.columns.map((c) => c.content)).toEqual(['Plan A', 'Plan B', 'Plan C']);
  expect(propose?.diverged).toBe(true);
  expect(propose?.isFinal).toBe(true);
});

test('separate broadcasts become separate rounds; debate rounds get a "· round N" label', () => {
  const rounds = groupReplyRounds([
    entry({ seq: 1, seatId: 'a', role: 'proposer', stage: 'propose', broadcastId: 'bc-0', content: 'A0' }),
    entry({ seq: 2, seatId: 'b', role: 'critic', stage: 'propose', broadcastId: 'bc-0', content: 'B0' }),
    entry({ seq: 3, seatId: 'a', role: 'proposer', stage: 'debate', broadcastId: 'debate-r1', content: 'A1' }),
    entry({ seq: 4, seatId: 'b', role: 'critic', stage: 'debate', broadcastId: 'debate-r1', content: 'B1' }),
    entry({ seq: 5, seatId: 'a', role: 'proposer', stage: 'debate', broadcastId: 'debate-r2', content: 'A2' }),
    entry({ seq: 6, seatId: 'b', role: 'critic', stage: 'debate', broadcastId: 'debate-r2', content: 'B2' }),
  ]);

  expect(rounds.map((r) => r.label)).toEqual(['Propose', 'Debate · round 1', 'Debate · round 2']);
  // Chronological order; only the last is the final positions.
  expect(rounds.map((r) => r.isFinal)).toEqual([false, false, true]);
});

test('a round where every seat agrees is marked aligned, not diverged', () => {
  const rounds = groupReplyRounds([
    entry({ seq: 1, seatId: 'a', role: 'proposer', broadcastId: 'bc-0', content: 'same' }),
    entry({ seq: 2, seatId: 'b', role: 'critic', broadcastId: 'bc-0', content: 'same' }),
  ]);
  expect(rounds[0]?.diverged).toBe(false);
});

test('conductor lines, human verdicts, and unlinked messages are never columns', () => {
  const rounds = groupReplyRounds([
    entry({ seq: 0, seatId: 'conductor', role: 'conductor', kind: 'note', stage: 'frame', content: 'framing' }),
    entry({ seq: 1, seatId: 'a', role: 'proposer', broadcastId: 'bc-1', content: 'A' }),
    // No broadcastId ⇒ not part of any side-by-side round.
    entry({ seq: 2, seatId: 'b', role: 'critic', content: 'unlinked' }),
    // The human gavel is a note, never a seat reply.
    entry({ seq: 3, seatId: 'human', role: 'human', kind: 'note', stage: 'converge', content: 'Human verdict — REJECT' }),
  ]);

  expect(rounds).toHaveLength(1);
  expect(rounds[0]?.columns.map((c) => c.seatId)).toEqual(['a']);
});

test('deduped + ordered by seq — a re-delivery cannot double a column or reorder rounds', () => {
  const rounds = groupReplyRounds([
    entry({ seq: 2, seatId: 'b', role: 'critic', broadcastId: 'bc-0', content: 'B' }),
    entry({ seq: 1, seatId: 'a', role: 'proposer', broadcastId: 'bc-0', content: 'A' }),
    // Re-delivery of seq 1 (last-write-wins) must not add a second column.
    entry({ seq: 1, seatId: 'a', role: 'proposer', broadcastId: 'bc-0', content: 'A' }),
  ]);

  expect(rounds).toHaveLength(1);
  expect(rounds[0]?.columns.map((c) => c.seatId)).toEqual(['a', 'b']);
});

test('an empty transcript produces no rounds', () => {
  expect(groupReplyRounds([])).toEqual([]);
});
