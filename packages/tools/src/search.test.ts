import { test, expect, describe } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { globToRegExp, filterByGlob, grepNode } from './search.js';

describe('globToRegExp', () => {
  test('* matches within a path segment only', () => {
    const re = globToRegExp('src/*.ts');
    expect(re.test('src/a.ts')).toBe(true);
    expect(re.test('src/nested/a.ts')).toBe(false);
  });

  test('** matches across segments', () => {
    const re = globToRegExp('src/**/*.ts');
    expect(re.test('src/a.ts')).toBe(true);
    expect(re.test('src/nested/deep/a.ts')).toBe(true);
    expect(re.test('other/a.ts')).toBe(false);
  });

  test('? matches a single non-separator char', () => {
    const re = globToRegExp('a?.ts');
    expect(re.test('ab.ts')).toBe(true);
    expect(re.test('a/.ts')).toBe(false);
  });

  test('escapes regex metacharacters in literals', () => {
    const re = globToRegExp('a.b.ts');
    expect(re.test('a.b.ts')).toBe(true);
    expect(re.test('axbxts')).toBe(false);
  });
});

describe('filterByGlob', () => {
  test('returns only matching paths', () => {
    const paths = ['src/a.ts', 'src/b.js', 'src/nested/c.ts'];
    expect(filterByGlob(paths, 'src/**/*.ts').sort()).toEqual([
      'src/a.ts',
      'src/nested/c.ts',
    ]);
  });
});

describe('grepNode', () => {
  test('finds matching lines with path:line:content format', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nc-grep-'));
    try {
      await mkdir(path.join(dir, 'sub'), { recursive: true });
      await writeFile(path.join(dir, 'a.txt'), 'alpha\nNEEDLE here\nomega\n');
      await writeFile(path.join(dir, 'sub', 'b.txt'), 'no match\n');

      const hits = await grepNode('NEEDLE', dir, '');
      expect(hits.length).toBe(1);
      expect(hits[0]).toBe('a.txt:2:NEEDLE here');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('honours the case-insensitive flag', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nc-grep-'));
    try {
      await writeFile(path.join(dir, 'a.txt'), 'Hello World\n');
      const sensitive = await grepNode('hello', dir, '');
      const insensitive = await grepNode('hello', dir, 'i');
      expect(sensitive.length).toBe(0);
      expect(insensitive.length).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
