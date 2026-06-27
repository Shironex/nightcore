// @ts-check
import type { IMetaRule, IViolation } from '../types';

/**
 * Test runner is segregated by workspace: node/TS packages + apps/{cli,sidecar,
 * tui} use `bun:test`; apps/web and packages/eslint-plugin use Vitest. Never mix
 * runners in one package. bun-side files must import `bun:test` and never
 * `vitest`; vitest-side files must never import `bun:test` (they may import via
 * shared test-utils that re-export Vitest, so a direct `vitest` import is not
 * required).
 */
export const testRunnerSegregationRule: IMetaRule = {
  id: 'test-runner-segregation',
  category: 'testing',
  ciCritical: true,
  description:
    'bun:test for node/TS packages + apps/{cli,sidecar,tui}; Vitest for apps/web + packages/eslint-plugin. Never mix runners.',
  run(ctx) {
    const violations: IViolation[] = [];
    const VITEST_DIRS = ['apps/web', 'packages/eslint-plugin'];
    const pkgDirs = ctx
      .glob('packages/*/package.json')
      .map((p) => p.replace(/\/package\.json$/, ''));
    const bunDirs = [
      ...pkgDirs.filter((d) => !VITEST_DIRS.includes(d)),
      'apps/cli',
      'apps/sidecar',
      'apps/tui',
    ];
    const testsIn = (dir: string) => [
      ...ctx.glob(`${dir}/**/*.test.ts`),
      ...ctx.glob(`${dir}/**/*.test.tsx`),
    ];
    for (const dir of bunDirs) {
      for (const f of testsIn(dir)) {
        const body = ctx.read(f) ?? '';
        if (/from\s+['"]vitest['"]/.test(body)) {
          violations.push({ file: f, rule: 'test-runner-segregation', message: "Node package test imports 'vitest' — use 'bun:test'." });
        }
        if (!/from\s+['"]bun:test['"]/.test(body)) {
          violations.push({ file: f, rule: 'test-runner-segregation', message: "Node package test must import its runner from 'bun:test'." });
        }
      }
    }
    for (const dir of VITEST_DIRS) {
      for (const f of testsIn(dir)) {
        const body = ctx.read(f) ?? '';
        if (/from\s+['"]bun:test['"]/.test(body)) {
          violations.push({ file: f, rule: 'test-runner-segregation', message: "Vitest-based package test imports 'bun:test' — use Vitest." });
        }
      }
    }
    return violations;
  },
};
