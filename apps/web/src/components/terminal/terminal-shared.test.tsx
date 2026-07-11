import { describe, expect, test } from 'vitest';

import { displayPath, gridColumns, terminalLabel, unreadBadge } from './terminal-shared';

// Pure-string tests (no PTY, no host dependence) — these prove the Windows
// verbatim-prefix display fix on any CI host, including the Linux/macOS boxes that
// never produce a `\\?\` path themselves.

describe('displayPath', () => {
  test('strips the Windows verbatim drive prefix (the reported picker bug)', () => {
    expect(displayPath('\\\\?\\X:\\dev\\nightcore')).toBe('X:\\dev\\nightcore');
  });

  test('rewrites a verbatim UNC prefix to a normal UNC path', () => {
    expect(displayPath('\\\\?\\UNC\\server\\share\\wt')).toBe('\\\\server\\share\\wt');
  });

  test('passes POSIX paths through untouched', () => {
    expect(displayPath('/Users/dev/nightcore')).toBe('/Users/dev/nightcore');
    expect(displayPath('/bin/zsh')).toBe('/bin/zsh');
  });

  test('passes already-clean Windows paths through untouched', () => {
    expect(displayPath('C:\\dev\\nightcore')).toBe('C:\\dev\\nightcore');
  });

  test('is idempotent (prettifying a prettified path is a no-op)', () => {
    const once = displayPath('\\\\?\\X:\\dev\\nightcore');
    expect(displayPath(once)).toBe(once);
  });
});

describe('terminalLabel', () => {
  test('takes the last segment of a POSIX path', () => {
    expect(terminalLabel('/Users/dev/nightcore')).toBe('nightcore');
  });

  test('takes the last segment of a Windows path (splits on both separators)', () => {
    expect(terminalLabel('X:\\dev\\nightcore')).toBe('nightcore');
  });

  test('strips the verbatim prefix before labeling a Windows worktree cwd', () => {
    expect(
      terminalLabel('\\\\?\\X:\\dev\\nightcore\\.nightcore\\worktrees\\task-42'),
    ).toBe('task-42');
  });
});

describe('gridColumns', () => {
  test('maps the session count to the locked column count (decision 1)', () => {
    // 1→1×1, 2→1×2, ≤4→2×2, ≤6→2×3, ≤9→3×3, else (10–12) 3×4.
    expect(gridColumns(1)).toBe(1);
    expect(gridColumns(2)).toBe(2);
    expect(gridColumns(3)).toBe(2);
    expect(gridColumns(4)).toBe(2);
    expect(gridColumns(5)).toBe(3);
    expect(gridColumns(6)).toBe(3);
    expect(gridColumns(7)).toBe(3);
    expect(gridColumns(9)).toBe(3);
    expect(gridColumns(10)).toBe(4);
    expect(gridColumns(12)).toBe(4);
  });

  test('clamps a zero/negative count to one column', () => {
    expect(gridColumns(0)).toBe(1);
    expect(gridColumns(-3)).toBe(1);
  });
});

describe('unreadBadge', () => {
  test('shows the raw count, clamping past 99 to 99+', () => {
    expect(unreadBadge(0)).toBe('0');
    expect(unreadBadge(7)).toBe('7');
    expect(unreadBadge(99)).toBe('99');
    expect(unreadBadge(128)).toBe('99+');
  });
});
