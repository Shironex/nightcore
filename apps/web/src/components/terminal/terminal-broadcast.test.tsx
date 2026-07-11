import { afterEach, describe, expect, test } from 'vitest';

import {
  isBroadcastArmed,
  isBroadcastEligible,
  resolveBroadcastTargets,
  setBroadcastArmed,
  writeToTargets,
} from './terminal-broadcast';

// The armed flag is module-level (mirrored from the view's React state); reset it
// between tests so one test's arm never leaks into another.
afterEach(() => setBroadcastArmed(false));

describe('resolveBroadcastTargets (fan-out targeting — visible-only)', () => {
  test('disarmed → the origin alone, ignoring the visible set', () => {
    expect(resolveBroadcastTargets('a', false, ['a', 'b', 'c'])).toEqual(['a']);
  });

  test('armed → every VISIBLE pane (visible-only), the origin included', () => {
    expect(new Set(resolveBroadcastTargets('a', true, ['a', 'b', 'c']))).toEqual(
      new Set(['a', 'b', 'c']),
    );
  });

  test('armed but no visible panes → the origin alone (never an empty write)', () => {
    expect(resolveBroadcastTargets('a', true, [])).toEqual(['a']);
  });

  test('armed always keeps the self-write even if the origin is absent from visible', () => {
    // Defensive: a keystroke from the focused pane must never vanish.
    expect(new Set(resolveBroadcastTargets('a', true, ['b', 'c']))).toEqual(
      new Set(['a', 'b', 'c']),
    );
  });

  test('dedupes so the origin is never written twice', () => {
    const targets = resolveBroadcastTargets('a', true, ['a', 'b']);
    expect(targets).toHaveLength(2);
    expect(new Set(targets)).toEqual(new Set(['a', 'b']));
  });
});

describe('isBroadcastEligible (arm gate + auto-disarm rule)', () => {
  test('grid view with 2+ visible panes is eligible', () => {
    expect(isBroadcastEligible(true, 2)).toBe(true);
    expect(isBroadcastEligible(true, 4)).toBe(true);
  });

  test('a single visible pane is never eligible (nothing to broadcast to)', () => {
    expect(isBroadcastEligible(true, 1)).toBe(false);
    expect(isBroadcastEligible(true, 0)).toBe(false);
  });

  test('tabs view is never eligible regardless of count', () => {
    expect(isBroadcastEligible(false, 3)).toBe(false);
    expect(isBroadcastEligible(false, 1)).toBe(false);
  });
});

describe('armed flag lifecycle', () => {
  test('starts disarmed, arms + disarms via setBroadcastArmed', () => {
    expect(isBroadcastArmed()).toBe(false);
    setBroadcastArmed(true);
    expect(isBroadcastArmed()).toBe(true);
    setBroadcastArmed(false);
    expect(isBroadcastArmed()).toBe(false);
  });

  test('the armed flag gates the resolved targets end-to-end', () => {
    setBroadcastArmed(false);
    expect(resolveBroadcastTargets('a', isBroadcastArmed(), ['a', 'b'])).toEqual(['a']);
    setBroadcastArmed(true);
    expect(new Set(resolveBroadcastTargets('a', isBroadcastArmed(), ['a', 'b']))).toEqual(
      new Set(['a', 'b']),
    );
  });
});

describe('writeToTargets (the fan-out writer)', () => {
  // Outside Tauri the bridge write degrades to the in-memory echo (a no-op for an
  // unknown id), so this exercises the real writer end-to-end (including that it reads
  // the module armed flag) while asserting the returned target set — the observable of
  // which panes actually got written to. The paste path funnels here too (via `onData`).
  const bytes = new TextEncoder().encode('npm run build\r');

  test('disarmed → writes only the origin', () => {
    setBroadcastArmed(false);
    expect(writeToTargets('a', bytes, ['a', 'b', 'c'])).toEqual(['a']);
  });

  test('armed → writes every visible pane (visible-only), the origin included', () => {
    setBroadcastArmed(true);
    expect(new Set(writeToTargets('a', bytes, ['a', 'b', 'c']))).toEqual(
      new Set(['a', 'b', 'c']),
    );
  });

  test('armed with a collapsed visible set writes only what is still visible', () => {
    setBroadcastArmed(true);
    expect(new Set(writeToTargets('a', bytes, ['a']))).toEqual(new Set(['a']));
  });
});
