import { test, expect, describe } from 'bun:test';
import { applyEdit } from './fs.js';

describe('applyEdit', () => {
  test('replaces a unique occurrence', () => {
    const result = applyEdit('const a = 1;', 'a', 'b', false);
    expect(result).toEqual({ ok: true, text: 'const b = 1;', replacements: 1 });
  });

  test('fails when oldString is absent', () => {
    const result = applyEdit('hello', 'xyz', 'abc', false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('not found');
  });

  test('fails on ambiguous match without replaceAll', () => {
    const result = applyEdit('a a a', 'a', 'b', false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('ambiguous');
  });

  test('replaceAll rewrites every occurrence and counts them', () => {
    const result = applyEdit('a a a', 'a', 'b', true);
    expect(result).toEqual({ ok: true, text: 'b b b', replacements: 3 });
  });

  test('rejects empty oldString', () => {
    const result = applyEdit('anything', '', 'x', false);
    expect(result.ok).toBe(false);
  });

  test('does not mutate when the single-replace guard trips', () => {
    const source = 'foo foo';
    const result = applyEdit(source, 'foo', 'bar', false);
    expect(result.ok).toBe(false);
  });
});
