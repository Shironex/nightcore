/// <reference types="bun" />
import { describe, expect, mock, test } from 'bun:test';
import type { Logger } from '@nightcore/shared';
import {
  HARNESS_BASH_DENY_RULE_ID,
  HARNESS_PROTECTED_PATH_RULE_ID,
  MANIFEST_PROTECTED_PATTERN,
  compileHarnessPolicy,
  evaluateHarnessPolicy,
  type CompiledHarnessPolicy,
} from './harness-policy.js';

const CWD = '/repo';

function fakeLogger(): Logger {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as unknown as Logger;
}

function compiled(
  protectedPaths: string[] = [],
  denyBashPatterns: string[] = [],
  logger?: Logger,
): CompiledHarnessPolicy {
  return compileHarnessPolicy({ protectedPaths, denyBashPatterns }, logger);
}

function write(policy: CompiledHarnessPolicy, filePath: string, cwd: string | undefined = CWD) {
  return evaluateHarnessPolicy('Write', { file_path: filePath }, policy, cwd);
}

function bash(policy: CompiledHarnessPolicy, command: string, cwd: string | undefined = CWD) {
  return evaluateHarnessPolicy('Bash', { command }, policy, cwd);
}

describe('protected paths — anchored patterns', () => {
  test('a glob pattern blocks a matching write and allows a non-match', () => {
    const policy = compiled(['migrations/**']);
    expect(write(policy, 'migrations/001_init.sql').denied).toBe(true);
    expect(write(policy, 'migrations/001_init.sql').ruleId).toBe(
      HARNESS_PROTECTED_PATH_RULE_ID,
    );
    expect(write(policy, 'src/app.ts').denied).toBe(false);
  });

  test('a non-glob anchored pattern protects its whole subtree', () => {
    const policy = compiled(['src/generated']);
    expect(write(policy, 'src/generated/api.ts').denied).toBe(true);
    expect(write(policy, 'src/generated').denied).toBe(true);
    expect(write(policy, 'src/generate/api.ts').denied).toBe(false);
    // `/repo/src/generated-extra` must not match `src/generated` (segment, not prefix).
    expect(write(policy, 'src/generated-extra/api.ts').denied).toBe(false);
  });

  test('an absolute in-cwd target is matched repo-relative', () => {
    const policy = compiled(['bun.lock']);
    expect(write(policy, '/repo/bun.lock').denied).toBe(true);
  });

  test('`**` in the middle of a pattern spans segments', () => {
    const policy = compiled(['packages/**/generated/**']);
    expect(write(policy, 'packages/a/b/generated/x.ts').denied).toBe(true);
    expect(write(policy, 'packages/a/generated/x.ts').denied).toBe(true);
    expect(write(policy, 'packages/a/src/x.ts').denied).toBe(false);
  });

  test('`*` matches within a segment only', () => {
    const policy = compiled(['*.sql']);
    // Floating basename pattern: any depth.
    expect(write(policy, 'db/001.sql').denied).toBe(true);
    const anchored = compiled(['db/*.sql']);
    expect(write(anchored, 'db/001.sql').denied).toBe(true);
    expect(write(anchored, 'db/deep/001.sql').denied).toBe(false);
  });
});

describe('protected paths — floating patterns', () => {
  test('a bare filename pattern matches at any depth', () => {
    const policy = compiled(['bun.lock']);
    expect(write(policy, 'bun.lock').denied).toBe(true);
    expect(write(policy, 'packages/web/bun.lock').denied).toBe(true);
    expect(write(policy, 'src/app.ts').denied).toBe(false);
  });

  test('a floating glob matches lockfiles anywhere', () => {
    const policy = compiled(['*.lock']);
    expect(write(policy, 'deep/nested/Cargo.lock').denied).toBe(true);
    expect(write(policy, 'deep/nested/cargo.toml').denied).toBe(false);
  });

  test('matching is case-insensitive (case-variant writes cannot slip through)', () => {
    const policy = compiled(['bun.lock']);
    expect(write(policy, 'BUN.LOCK').denied).toBe(true);
  });
});

describe('protected paths — implicit self-protection', () => {
  test('.nightcore/** is protected even with an EMPTY policy', () => {
    const policy = compiled([]);
    const verdict = write(policy, '.nightcore/harness.json');
    expect(verdict.denied).toBe(true);
    expect(verdict.reason).toContain(MANIFEST_PROTECTED_PATTERN);
    expect(write(policy, '.nightcore/tasks/t1.json').denied).toBe(true);
  });

  test('Edit / MultiEdit / NotebookEdit are covered like Write', () => {
    const policy = compiled([]);
    for (const tool of ['Edit', 'MultiEdit']) {
      const verdict = evaluateHarnessPolicy(
        tool,
        { file_path: '.nightcore/harness.json' },
        policy,
        CWD,
      );
      expect(verdict.denied).toBe(true);
    }
    const notebook = evaluateHarnessPolicy(
      'NotebookEdit',
      { notebook_path: '.nightcore/harness.json' },
      policy,
      CWD,
    );
    expect(notebook.denied).toBe(true);
  });
});

describe('protected paths — jurisdiction boundaries', () => {
  test('a target OUTSIDE the run cwd is left alone (confinement owns it)', () => {
    const policy = compiled(['bun.lock']);
    expect(write(policy, '/elsewhere/bun.lock').denied).toBe(false);
    // The `/repo-evil` prefix trick resolves outside `/repo` — not ours to judge.
    expect(write(policy, '/repo-evil/bun.lock').denied).toBe(false);
    // `..` traversal that escapes the cwd is confinement's catch too.
    expect(write(policy, '../outside/bun.lock').denied).toBe(false);
  });

  test('`..` traversal that stays inside the cwd is still matched', () => {
    const policy = compiled(['bun.lock']);
    expect(write(policy, 'src/../bun.lock').denied).toBe(true);
  });

  test('an unreadable target is left alone (confinement fail-closes it first)', () => {
    const policy = compiled(['bun.lock']);
    expect(evaluateHarnessPolicy('Write', {}, policy, CWD).denied).toBe(false);
    expect(evaluateHarnessPolicy('Write', null, policy, CWD).denied).toBe(false);
  });

  test('path rules are skipped without a cwd (nothing to resolve against)', () => {
    const policy = compiled(['bun.lock']);
    // Call directly: the `write` helper's default param would re-supply a cwd.
    const verdict = evaluateHarnessPolicy(
      'Write',
      { file_path: 'bun.lock' },
      policy,
      undefined,
    );
    expect(verdict.denied).toBe(false);
  });

  test('non-mutation tools are never path-checked', () => {
    const policy = compiled(['bun.lock']);
    for (const tool of ['Read', 'Grep', 'Glob', 'WebFetch']) {
      const verdict = evaluateHarnessPolicy(
        tool,
        { file_path: 'bun.lock' },
        policy,
        CWD,
      );
      expect(verdict.denied).toBe(false);
    }
  });
});

describe('bash deny patterns', () => {
  test('a matching command is denied with the pattern in the reason', () => {
    const policy = compiled([], ['--no-verify']);
    const verdict = bash(policy, 'git commit --no-verify -m "wip"');
    expect(verdict.denied).toBe(true);
    expect(verdict.ruleId).toBe(HARNESS_BASH_DENY_RULE_ID);
    expect(verdict.reason).toContain('--no-verify');
  });

  test('a non-matching command is allowed', () => {
    const policy = compiled([], ['--no-verify']);
    expect(bash(policy, 'git commit -m "ok"').denied).toBe(false);
  });

  test('patterns are real regexes', () => {
    const policy = compiled([], ['npm\\s+install\\s+(?!--package-lock-only)']);
    expect(bash(policy, 'npm install left-pad').denied).toBe(true);
    expect(bash(policy, 'npm install --package-lock-only').denied).toBe(false);
  });

  test('bash rules enforce even without a cwd', () => {
    const policy = compiled([], ['--no-verify']);
    // Call directly: the `bash` helper's default param would re-supply a cwd.
    const verdict = evaluateHarnessPolicy(
      'Bash',
      { command: 'git commit --no-verify' },
      policy,
      undefined,
    );
    expect(verdict.denied).toBe(true);
  });

  test('an invalid regex is warn-and-skipped; valid rules still enforce', () => {
    const logger = fakeLogger();
    const policy = compiled([], ['(unclosed', '--no-verify'], logger);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(policy.bashRules).toHaveLength(1);
    expect(bash(policy, 'git commit --no-verify').denied).toBe(true);
  });

  test('a bash command with no protected-path relevance is not path-checked', () => {
    // Bash is NOT confined by protectedPaths (documented residual gap) — only
    // denyBashPatterns govern it.
    const policy = compiled(['bun.lock'], []);
    expect(bash(policy, 'echo x > bun.lock').denied).toBe(false);
  });
});

describe('compile hygiene', () => {
  test('empty / degenerate path patterns are skipped, not fatal', () => {
    const logger = fakeLogger();
    const policy = compiled(['', '   ', '/'], [], logger);
    // Only the implicit manifest rule survives.
    expect(policy.pathRules).toHaveLength(1);
    expect(policy.pathRules[0]!.pattern).toBe(MANIFEST_PROTECTED_PATTERN);
  });

  test('author sugar is tolerated: leading ./ or / and a trailing /', () => {
    const policy = compiled(['./migrations/', '/src/generated/']);
    expect(write(policy, 'migrations/001.sql').denied).toBe(true);
    expect(write(policy, 'src/generated/api.ts').denied).toBe(true);
  });

  test('regex metacharacters in a path pattern are literal', () => {
    const policy = compiled(['file.(x)+?.ts']);
    expect(write(policy, 'file.(x)+?.ts').denied).toBe(true);
    expect(write(policy, 'fileA(x)Bts').denied).toBe(false);
  });
});
