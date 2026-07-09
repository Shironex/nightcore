/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import { normalizeText, toPosixRel } from './paths.ts';

describe('toPosixRel', () => {
  test('converts backslashes to forward slashes', () => {
    expect(toPosixRel('packages\\storage\\package.json')).toBe(
      'packages/storage/package.json',
    );
    expect(toPosixRel('apps/web/src/components/ui/Button/index.ts')).toBe(
      'apps/web/src/components/ui/Button/index.ts',
    );
  });

  test('leaves posix paths unchanged', () => {
    expect(toPosixRel('packages/contracts/package.json')).toBe(
      'packages/contracts/package.json',
    );
  });
});

describe('normalizeText', () => {
  test('converts CRLF to LF', () => {
    expect(normalizeText('line one\r\nline two\r\n')).toBe('line one\nline two\n');
  });

  test('converts lone CR to LF', () => {
    expect(normalizeText("  // NEVER 'warn' (`rule`).\r")).toBe(
      "  // NEVER 'warn' (`rule`).\n",
    );
  });

  test('leaves LF-only text unchanged', () => {
    expect(normalizeText('already\nlf\n')).toBe('already\nlf\n');
  });
});
