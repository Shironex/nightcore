/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_NO_PROGRESS_ROUNDS,
  distinctPositions,
  NoProgressDetector,
  normalizePosition,
} from './no-progress-detector.js';

describe('normalizePosition / distinctPositions (the #353 reply-diff distinct rule)', () => {
  test('a position identity is its trimmed content — the reply-diff rule, nothing fuzzier', () => {
    expect(normalizePosition('  keep the monolith  ')).toBe('keep the monolith');
    // Only-whitespace differences collapse to the SAME position (as the reply diff's
    // `new Set(columns.map((c) => c.content.trim()))` treats them).
    expect(normalizePosition('X\n')).toBe(normalizePosition('  X'));
    // A genuine textual difference is a DIFFERENT position (no semantic merge).
    expect(normalizePosition('X because Y')).not.toBe(normalizePosition('X because Z'));
  });

  test('distinctPositions counts trim-normalized replies, deduping whitespace variants', () => {
    const distinct = distinctPositions(['X', ' X ', 'Y', 'Y\n', 'Z']);
    expect(distinct.size).toBe(3);
    expect([...distinct].sort()).toEqual(['X', 'Y', 'Z']);
  });
});

describe('NoProgressDetector — churn vs progress', () => {
  test('churn (positions reshuffled, never new) stalls at the threshold', () => {
    // Seeded with the Propose positions {X, Y}. Each round swaps who holds what — the
    // seats KEEP changing (stability never fires) but no NEW distinct position appears.
    const detector = new NoProgressDetector(['X', 'Y']);
    expect(DEFAULT_NO_PROGRESS_ROUNDS).toBe(2);
    expect(detector.observeRound(['Y', 'X'])).toBe(false); // streak 1 — one flat round
    expect(detector.observeRound(['X', 'Y'])).toBe(true); //  streak 2 — STALL
  });

  test('genuine progress (a new distinct position each round) never stalls', () => {
    const detector = new NoProgressDetector(['A0', 'B0']);
    for (let round = 1; round <= 10; round++) {
      // Every round introduces brand-new positions — real information each time.
      expect(detector.observeRound([`A${round}`, `B${round}`])).toBe(false);
    }
  });

  test('a single flat round between productive rounds does NOT trip a stall', () => {
    const detector = new NoProgressDetector(['X', 'Y']);
    expect(detector.observeRound(['X', 'Y'])).toBe(false); // flat: streak 1
    expect(detector.observeRound(['Z', 'W'])).toBe(false); // progress resets streak to 0
    expect(detector.observeRound(['Z', 'W'])).toBe(false); // flat again: streak 1, not 2
  });

  test('a partly-new round is progress — one new distinct position resets the streak', () => {
    const detector = new NoProgressDetector(['X', 'Y']);
    expect(detector.observeRound(['X', 'Y'])).toBe(false); // streak 1
    // One seat restates (X, already seen), the other says something NEW (Q) — net-new ⇒
    // progress, streak resets.
    expect(detector.observeRound(['X', 'Q'])).toBe(false);
    expect(detector.observeRound(['X', 'Q'])).toBe(false); // now streak 1 again, not stalled
  });

  test('the threshold is configurable and clamped to at least one round', () => {
    // Threshold 1 ⇒ the first flat round is already a stall.
    const eager = new NoProgressDetector(['X'], 1);
    expect(eager.observeRound(['X'])).toBe(true);

    // A non-positive / fractional threshold is clamped to >= 1 (never zero rounds).
    const clamped = new NoProgressDetector(['X'], 0);
    expect(clamped.observeRound(['X'])).toBe(true);
  });

  test('an empty seed means a debate round always adds new positions the first time', () => {
    const detector = new NoProgressDetector();
    expect(detector.observeRound(['X', 'Y'])).toBe(false); // first sight ⇒ progress
    expect(detector.observeRound(['X', 'Y'])).toBe(false); // now seen: streak 1
    expect(detector.observeRound(['X', 'Y'])).toBe(true); //  streak 2 ⇒ stall
  });
});
