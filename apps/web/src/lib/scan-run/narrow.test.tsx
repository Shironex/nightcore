import { describe, expect, it } from 'vitest';

import { type FindingSeverity, FindingSeveritySchema } from '@nightcore/contracts';

import { enumGuard, narrowMembers, narrowOr } from './narrow';

describe('narrowOr', () => {
  it('returns a valid member unchanged (contract schema)', () => {
    expect(narrowOr(FindingSeveritySchema, 'critical', 'info')).toBe('critical');
  });

  it('falls back on an invalid value rather than leaking it', () => {
    expect(narrowOr(FindingSeveritySchema, 'bogus', 'info')).toBe('info');
  });

  it('falls back on a non-string value (null / number)', () => {
    expect(narrowOr(FindingSeveritySchema, null, 'info')).toBe('info');
    expect(narrowOr(FindingSeveritySchema, 42, 'info')).toBe('info');
  });

  it('supports a nullable fallback via an explicit (widened) type argument', () => {
    // The explicit `<FindingSeverity | null>` widens the schema's union with `null`
    // (the pattern `storedToVerdict` uses for the nullable complexity). Both null and
    // an invalid value degrade to null — no fabricated member.
    expect(narrowOr<FindingSeverity | null>(FindingSeveritySchema, null, null)).toBeNull();
    expect(narrowOr<FindingSeverity | null>(FindingSeveritySchema, 'bogus', null)).toBeNull();
    expect(narrowOr<FindingSeverity | null>(FindingSeveritySchema, 'low', null)).toBe('low');
  });
});

describe('narrowMembers', () => {
  it('keeps valid members and drops unknown ones (order preserved)', () => {
    expect(
      narrowMembers(FindingSeveritySchema, ['low', 'bogus', 'high', 7, null]),
    ).toEqual(['low', 'high']);
  });

  it('returns an empty array when nothing is valid', () => {
    expect(narrowMembers(FindingSeveritySchema, ['nope', 'zzz'])).toEqual([]);
  });
});

describe('enumGuard', () => {
  const STATUS = enumGuard(['open', 'dismissed', 'converted'] as const);

  it('accepts a member and rejects a non-member for narrowOr', () => {
    expect(narrowOr(STATUS, 'dismissed', 'open')).toBe('dismissed');
    expect(narrowOr(STATUS, 'bogus', 'open')).toBe('open');
    expect(narrowOr(STATUS, undefined, 'open')).toBe('open');
  });
});
