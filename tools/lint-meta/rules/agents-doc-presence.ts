// @ts-check
import type { IMetaRule, IViolation } from '../types';

/**
 * Agent-contract coverage. Every deployable surface and public boundary must
 * ship an `AGENTS.md` so an agent editing it reads the guardrails first. This
 * rule requires an `AGENTS.md` at:
 *   - the repo root,
 *   - every `apps/*` (all surfaces), and
 *   - every `packages/*` EXCEPT the explicit leaf opt-out set below.
 *
 * The opt-out set is the trivial/leaf packages that carry no contract today; a
 * NEW package must ship AGENTS.md by default. Keep the set minimal — a boundary
 * package (public API, wire, persistence) should never be on it. To require a
 * doc for a package currently opted out, remove it here and add the doc in the
 * same change.
 */
const PACKAGE_OPT_OUT = new Set<string>([
  'packages/config',
  'packages/shared',
  'packages/storage',
  'packages/session-fold',
  'packages/eslint-plugin',
]);

export const agentsDocPresenceRule: IMetaRule = {
  id: 'agents-doc-presence',
  category: 'source-text',
  ciCritical: true,
  description:
    'AGENTS.md must exist at the repo root, every apps/*, and every non-leaf packages/* (leaf packages are opt-out).',
  run(ctx) {
    const violations: IViolation[] = [];
    const requireDoc = (dir: string, label: string) => {
      const rel = dir === '' ? 'AGENTS.md' : `${dir}/AGENTS.md`;
      if (!ctx.exists(rel)) {
        violations.push({
          file: rel,
          rule: 'agents-doc-presence',
          message: `${label} is missing an AGENTS.md agent contract. Add one (or, for a trivial leaf package, add it to PACKAGE_OPT_OUT with justification).`,
        });
      }
    };

    requireDoc('', 'The repo root');
    for (const pkg of ctx.glob('apps/*/package.json')) {
      requireDoc(pkg.replace(/\/package\.json$/, ''), 'Surface');
    }
    for (const pkg of ctx.glob('packages/*/package.json')) {
      const dir = pkg.replace(/\/package\.json$/, '');
      if (PACKAGE_OPT_OUT.has(dir)) continue;
      requireDoc(dir, 'Package');
    }
    return violations;
  },
};
