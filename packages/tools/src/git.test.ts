import { test, expect, describe } from 'bun:test';
import { parseGitStatus, describeStatus } from './git.js';

describe('parseGitStatus', () => {
  test('parses modified, staged, and untracked entries', () => {
    const porcelain = [' M src/a.ts', 'A  src/b.ts', '?? scratch.txt'].join('\n');
    expect(parseGitStatus(porcelain)).toEqual([
      { status: ' M', path: 'src/a.ts' },
      { status: 'A ', path: 'src/b.ts' },
      { status: '??', path: 'scratch.txt' },
    ]);
  });

  test('reports the destination path for renames', () => {
    const entries = parseGitStatus('R  old/name.ts -> new/name.ts');
    expect(entries).toEqual([{ status: 'R ', path: 'new/name.ts' }]);
  });

  test('ignores blank and too-short lines', () => {
    expect(parseGitStatus('\n  \n M f.ts')).toEqual([{ status: ' M', path: 'f.ts' }]);
  });

  test('returns an empty array for a clean tree', () => {
    expect(parseGitStatus('')).toEqual([]);
  });
});

describe('describeStatus', () => {
  test('maps known codes to labels', () => {
    expect(describeStatus(' M')).toBe('modified');
    expect(describeStatus('??')).toBe('untracked');
    expect(describeStatus('A ')).toBe('added');
  });

  test('falls back to the trimmed code for unknown statuses', () => {
    expect(describeStatus('XY')).toBe('XY');
  });
});
