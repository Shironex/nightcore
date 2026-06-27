// @ts-check
import type { IMetaRule, IViolation } from '../types';

/**
 * Workspace dependency-graph parity. For each workspace package:
 *  (a) every `@nightcore/<pkg>` imported in src/ must be declared as a
 *      `workspace:*` dependency in package.json, and
 *  (b) its tsconfig.json `references` must mirror exactly those workspace deps.
 * So a new cross-package edge can never be half-wired (imported but undeclared,
 * or declared but missing from the TS project graph).
 */
export const workspaceGraphParityRule: IMetaRule = {
  id: 'workspace-graph-parity',
  category: 'config',
  ciCritical: true,
  description:
    'Imported @nightcore/* specifiers must be declared workspace:* deps, and tsconfig references must mirror those deps.',
  run(ctx) {
    const violations: IViolation[] = [];
    const pkgJsons = [
      ...ctx.glob('packages/*/package.json'),
      ...ctx.glob('apps/*/package.json'),
    ];
    for (const rel of pkgJsons) {
      const raw = ctx.read(rel);
      if (raw === null) continue;
      const dir = rel.replace(/\/package\.json$/, '');
      const self = `@nightcore/${dir.split('/').pop()}`;

      const declared = new Set(
        Array.from(
          raw.matchAll(/"(@nightcore\/[a-z0-9-]+)"\s*:\s*"workspace:[^"]*"/g),
          (m) => m[1],
        ),
      );

      const imported = new Set<string>();
      const srcFiles = [
        ...ctx.glob(`${dir}/src/**/*.ts`),
        ...ctx.glob(`${dir}/src/**/*.tsx`),
      ];
      for (const f of srcFiles) {
        if (f.endsWith('.test.ts') || f.endsWith('.test.tsx')) continue;
        const body = ctx.read(f) ?? '';
        for (const m of body.matchAll(/from\s+['"](@nightcore\/[a-z0-9-]+)/g)) {
          if (m[1] !== self) imported.add(m[1]);
        }
      }

      // (a) imported subset of declared
      for (const spec of imported) {
        if (!declared.has(spec)) {
          violations.push({
            file: rel,
            rule: 'workspace-graph-parity',
            message: `${self} imports ${spec} but does not declare it as a "workspace:*" dependency. Add it to package.json.`,
          });
        }
      }

      // (b) tsconfig references mirror declared deps
      const tsconfig = ctx.read(`${dir}/tsconfig.json`);
      if (tsconfig !== null) {
        const refDirs = new Set(
          Array.from(tsconfig.matchAll(/"path"\s*:\s*"([^"]+)"/g), (m) => {
            const parts = m[1].split('/').filter(Boolean);
            return `@nightcore/${parts[parts.length - 1]}`;
          }),
        );
        for (const dep of declared) {
          if (!refDirs.has(dep)) {
            violations.push({
              file: `${dir}/tsconfig.json`,
              rule: 'workspace-graph-parity',
              message: `tsconfig "references" is missing ${dep}, a declared workspace:* dependency. References must mirror deps.`,
            });
          }
        }
        for (const ref of refDirs) {
          if (!declared.has(ref)) {
            violations.push({
              file: `${dir}/tsconfig.json`,
              rule: 'workspace-graph-parity',
              message: `tsconfig references ${ref} but it is not a declared workspace:* dependency. References must mirror deps.`,
            });
          }
        }
      }
    }
    return violations;
  },
};
