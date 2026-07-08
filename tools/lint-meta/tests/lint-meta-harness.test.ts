/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import { noWarnSeverityRule } from '../rules/no-warn-severity.ts';
import { packageShapeRule } from '../rules/package-shape.ts';
import { createFakeCtx, type FakeFiles } from './test-utils/createFakeCtx.ts';

/**
 * Smoke tests for the lint-meta test harness itself + two rules.
 * These exercise the fake IMetaCtx in isolation (no live filesystem).
 */

describe('lint-meta test harness (createFakeCtx)', () => {
  test('read returns content or null', () => {
    const ctx = createFakeCtx({ files: { 'foo.txt': 'bar' } });
    expect(ctx.read('foo.txt')).toBe('bar');
    expect(ctx.read('missing')).toBe(null);
  });

  test('exists matches presence (null content means absent)', () => {
    const ctx = createFakeCtx({ files: { 'present.txt': '', 'absent': null } });
    expect(ctx.exists('present.txt')).toBe(true);
    expect(ctx.exists('absent')).toBe(false);
    expect(ctx.exists('missing')).toBe(false);
  });

  test('glob matches simple * and literal patterns used by rules', () => {
    const files: FakeFiles = {
      'packages/foo/package.json': '{}',
      'packages/bar/package.json': '{}',
      'apps/web/package.json': '{}',
      'tools/lint-meta/cli.ts': '',
    };
    const ctx = createFakeCtx({ files });
    expect(ctx.glob('packages/*/package.json').sort()).toEqual([
      'packages/bar/package.json',
      'packages/foo/package.json',
    ]);
    expect(ctx.glob('apps/*/package.json')).toEqual(['apps/web/package.json']);
    expect(ctx.glob('tools/lint-meta/cli.ts')).toEqual(['tools/lint-meta/cli.ts']);
  });
});

describe('packageShapeRule (via fake ctx)', () => {
  const goodLib = JSON.stringify({
    name: '@nightcore/foo',
    main: './dist/index.js',
    module: './dist/index.js',
    types: './dist/index.d.ts',
    exports: { '.': './dist/index.js' },
  });

  test('clean synthetic tree reports zero violations', () => {
    const files: FakeFiles = {
      'packages/foo/package.json': goodLib,
      'packages/foo/src/index.ts': 'export {}',
      'apps/web/package.json': JSON.stringify({ name: '@nightcore/web' }),
    };
    const ctx = createFakeCtx({ files });
    const violations = packageShapeRule.run(ctx);
    expect(violations).toEqual([]);
  });

  test('mismatched name reports violation', () => {
    const files: FakeFiles = {
      'packages/bad/package.json': JSON.stringify({ name: '@wrong/bad' }),
      'packages/bad/src/index.ts': '',
    };
    const ctx = createFakeCtx({ files });
    const violations = packageShapeRule.run(ctx);
    expect(violations.length).toBe(1);
    expect(violations[0].rule).toBe('package-shape');
    expect(violations[0].message).toContain('@nightcore/bad');
  });

  test('missing barrel for library reports violation', () => {
    const files: FakeFiles = {
      'packages/nobarrel/package.json': goodLib,
      // no src/index.ts
    };
    const ctx = createFakeCtx({ files });
    const violations = packageShapeRule.run(ctx);
    expect(violations.some((v) => v.message.includes('barrel'))).toBe(true);
  });
});

describe('noWarnSeverityRule (via fake ctx)', () => {
  test('config without warn is clean', () => {
    const config = `
      export default [
        { rules: { 'foo': 'error' } },
      ];
    `;
    const ctx = createFakeCtx({ files: { 'eslint.config.mjs': config } });
    const violations = noWarnSeverityRule.run(ctx);
    expect(violations).toEqual([]);
  });

  test('config containing warn reports violation (strips comments)', () => {
    const config = `
      // a comment with "warn" should be ignored
      export default [ { rules: { x: 'warn' } } ];
    `;
    const ctx = createFakeCtx({ files: { 'eslint.config.mjs': config } });
    const violations = noWarnSeverityRule.run(ctx);
    expect(violations.length).toBe(1);
    expect(violations[0].file).toBe('eslint.config.mjs');
    expect(violations[0].message).toContain("'warn'");
  });
});
