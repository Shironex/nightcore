/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import {
  extractJson,
  isRawArrayShape,
  parseItems,
  toRawArray,
} from './json-extract.js';

describe('extractJson', () => {
  test('parses a bare JSON array', () => {
    expect(extractJson('[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  test('parses a ```json fenced block with surrounding prose', () => {
    const raw =
      'Here are the findings:\n```json\n[{"title":"x"}]\n```\nDone.';
    expect(extractJson(raw)).toEqual([{ title: 'x' }]);
  });

  test('extracts a balanced array from mixed prose', () => {
    const raw = 'blah blah [ {"title":"y"} ] trailing';
    expect(extractJson(raw)).toEqual([{ title: 'y' }]);
  });

  test('returns undefined when no JSON is present', () => {
    expect(extractJson('no json here at all')).toBeUndefined();
  });
});

describe('toRawArray', () => {
  test('passes a bare array through', () => {
    expect(toRawArray([1, 2], 'findings')).toEqual([1, 2]);
  });

  test('unwraps the keyed object envelope', () => {
    expect(toRawArray({ findings: ['a'] }, 'findings')).toEqual(['a']);
  });

  test('yields [] for any other shape', () => {
    expect(toRawArray({ other: [] }, 'findings')).toEqual([]);
    expect(toRawArray('nope', 'findings')).toEqual([]);
    expect(toRawArray(null, 'findings')).toEqual([]);
  });
});

describe('isRawArrayShape', () => {
  test('accepts a bare array and a keyed wrapper', () => {
    expect(isRawArrayShape([], 'findings')).toBe(true);
    expect(isRawArrayShape({ findings: [] }, 'findings')).toBe(true);
  });

  test('rejects objects without the key, scalars, and null', () => {
    expect(isRawArrayShape({ example: {} }, 'findings')).toBe(false);
    expect(isRawArrayShape({ findings: 'none' }, 'findings')).toBe(false);
    expect(isRawArrayShape(42, 'findings')).toBe(false);
    expect(isRawArrayShape(null, 'findings')).toBe(false);
  });
});

describe('parseItems', () => {
  const coerceString = (item: unknown): string | undefined =>
    typeof item === 'string' ? item : undefined;

  test('coerces items, skipping invalid ones without an error', () => {
    const { items, error } = parseItems(
      '["a", 1, "b"]',
      'findings',
      coerceString,
      'no JSON',
    );
    expect(items).toEqual(['a', 'b']);
    expect(error).toBeUndefined();
  });

  test('accepts the keyed wrapper and an empty array with no error', () => {
    expect(
      parseItems('{"findings": ["a"]}', 'findings', coerceString, 'no JSON').items,
    ).toEqual(['a']);
    const empty = parseItems('{"findings": []}', 'findings', coerceString, 'no JSON');
    expect(empty.items).toEqual([]);
    expect(empty.error).toBeUndefined();
  });

  test('errors with the caller message when no JSON is present', () => {
    const { items, error } = parseItems(
      'nothing to report',
      'findings',
      coerceString,
      'no JSON findings array in model output',
    );
    expect(items).toEqual([]);
    expect(error).toBe('no JSON findings array in model output');
  });

  test('errors on extracted JSON of the wrong shape (incidental example)', () => {
    const raw =
      'All clean. A finding would look like:\n```json\n{"example": {"title": "x"}}\n```\n';
    const { items, error } = parseItems(raw, 'findings', coerceString, 'no JSON');
    expect(items).toEqual([]);
    expect(error).toContain('not a findings array');
  });
});
