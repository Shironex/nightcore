// @ts-check
import type { IMetaRule, IViolation } from '../types';

/**
 * `test:node` enumerates the node/TS workspaces to test as a hardcoded path
 * list. A package added without editing that list runs in no CI gate. This rule
 * fails when any node package that HAS `*.test.ts` files is missing from the
 * script. Vitest-based packages (apps/web, eslint-plugin) run via test:web /
 * test:plugin and are excluded; apps/desktop is Rust (test:rust).
 */
export const testWorkspaceEnrollmentRule: IMetaRule = {
  id: 'test-workspace-enrollment',
  category: 'testing',
  ciCritical: true,
  description:
    'Every node/TS package with *.test.ts files must be enumerated in the root test:node script.',
  run(ctx) {
    const root = ctx.read('package.json');
    if (root === null) return [];
    let scripts: Record<string, string> = {};
    try {
      scripts = (JSON.parse(root).scripts ?? {}) as Record<string, string>;
    } catch {
      return [];
    }
    const testNode = scripts['test:node'] ?? '';
    const VITEST = new Set(['packages/eslint-plugin', 'apps/web']);
    const violations: IViolation[] = [];
    const dirs = [
      ...ctx.glob('packages/*/package.json').map((p) => p.replace(/\/package\.json$/, '')),
      'apps/sidecar',
    ];
    for (const dir of dirs) {
      if (VITEST.has(dir)) continue;
      const hasTests = ctx.glob(`${dir}/**/*.test.ts`).length > 0;
      if (!hasTests) continue;
      if (!testNode.includes(dir)) {
        violations.push({
          file: 'package.json',
          rule: 'test-workspace-enrollment',
          message: `Package '${dir}' has *.test.ts files but is not listed in the test:node script — its tests run in no CI gate. Add '${dir}' to test:node.`,
        });
      }
    }
    return violations;
  },
};
