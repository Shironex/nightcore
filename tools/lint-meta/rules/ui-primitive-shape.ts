// @ts-check
import type { IMetaRule, IViolation } from '../types';

/**
 * components/ui is the one folder exempt from folder-per-component: shadcn-style
 * primitives may be flat single .tsx files. But once a primitive graduates to a
 * folder (its own dir + index.ts barrel) it is a real component and must ship
 * the same proof-of-behavior siblings as any feature component: `<Name>.test.tsx`
 * and `<Name>.stories.tsx`. This closes the "ui mixes two folder shapes with no
 * rule" gap — flat = pure presentational; folder = tested + storied.
 *
 * Every ui folder-primitive carries an index.ts barrel, so glob those to
 * enumerate folders, then require the two siblings named after the folder (the
 * entry-file basename convention).
 */
const UI_ROOT = 'apps/web/src/components/ui';

export const uiPrimitiveShapeRule: IMetaRule = {
  id: 'ui-primitive-shape',
  category: 'source-text',
  ciCritical: true,
  description:
    'A components/ui primitive that is a folder must ship <Name>.test.tsx and <Name>.stories.tsx (flat primitives stay pure/presentational).',
  run(ctx) {
    const violations: IViolation[] = [];
    for (const barrel of ctx.glob(`${UI_ROOT}/*/index.ts`)) {
      const dir = barrel.replace(/\/index\.ts$/, '');
      const name = dir.split('/').pop() ?? dir;
      for (const role of ['test', 'stories'] as const) {
        const rel = `${dir}/${name}.${role}.tsx`;
        if (!ctx.exists(rel)) {
          violations.push({
            file: dir,
            rule: 'ui-primitive-shape',
            message: `ui folder-primitive '${name}' is missing ${name}.${role}.tsx. A ui primitive complex enough to be a folder must ship a test and a story (or stay a flat presentational .tsx).`,
          });
        }
      }
    }
    return violations;
  },
};
