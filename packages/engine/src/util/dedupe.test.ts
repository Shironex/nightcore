/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import { dedupeBy } from './dedupe.js';

interface Item {
  key: string;
  rank: number;
  tags: string[];
}

const item = (key: string, rank: number, tags: string[] = []): Item => ({
  key,
  rank,
  tags,
});

describe('dedupeBy', () => {
  test('keeps unique items order-stable', () => {
    const out = dedupeBy([item('a', 1), item('b', 2)], (i) => i.key, {
      rank: (i) => i.rank,
    });
    expect(out.map((i) => i.key)).toEqual(['a', 'b']);
  });

  test('higher rank wins; order stays on first appearance', () => {
    const out = dedupeBy(
      [item('a', 1), item('b', 5), item('a', 3)],
      (i) => i.key,
      { rank: (i) => i.rank },
    );
    expect(out.map((i) => [i.key, i.rank])).toEqual([
      ['a', 3],
      ['b', 5],
    ]);
  });

  test('a tie keeps the FIRST-seen instance', () => {
    const first = item('a', 2, ['first']);
    const second = item('a', 2, ['second']);
    const out = dedupeBy([first, second], (i) => i.key, { rank: (i) => i.rank });
    expect(out[0]?.tags).toEqual(['first']);
  });

  test('merge receives the winner plus both instances in encounter order', () => {
    const out = dedupeBy(
      [item('a', 1, ['x']), item('a', 4, ['y', 'x'])],
      (i) => i.key,
      {
        rank: (i) => i.rank,
        merge: (winner, existing, incoming) => ({
          ...winner,
          tags: [...new Set([...existing.tags, ...incoming.tags])],
        }),
      },
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.rank).toBe(4); // higher-severity instance won
    expect(out[0]?.tags).toEqual(['x', 'y']); // union, encounter-ordered
  });
});
