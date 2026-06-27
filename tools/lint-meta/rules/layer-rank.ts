// @ts-check
import type { IMetaRule, IViolation } from '../types';

/**
 * Layer ranks encode the fixed dependency direction:
 *   contracts(1) -> shared(2) -> storage(3)/skills(3) -> engine(4) -> surfaces(5)
 * A module may import only STRICTLY-lower-ranked @nightcore packages; equal
 * (sideways) or higher (upward) is forbidden. `shared` sits below `storage`
 * because storage depends on shared (utility leaf); `storage` and `skills` are
 * co-tier (rank 3) — neither imports the other, so the equal-rank ban never
 * fires between them, but a future edge in either direction would be flagged.
 * Unranked @nightcore packages (e.g. config, session-fold) are leaf utilities
 * outside the documented spine — an import of one is skipped, and a module
 * living in one is skipped, so this rule never produces a false positive on a
 * package whose tier isn't fixed.
 */
const RANK: Record<string, number> = {
  contracts: 1,
  shared: 2,
  storage: 3,
  skills: 3,
  engine: 4,
};
const SURFACE_RANK = 5;

function importerRank(rel: string): number | null {
  if (rel.startsWith('apps/')) return SURFACE_RANK;
  const m = rel.match(/^packages\/([^/]+)\//);
  if (!m) return null;
  return RANK[m[1]] ?? null;
}

export const layerRankRule: IMetaRule = {
  id: 'layer-rank',
  category: 'source-text',
  ciCritical: true,
  description:
    'Fixed direction contracts -> shared -> storage/skills -> engine -> surfaces: import only strictly-lower-ranked @nightcore packages.',
  run(ctx) {
    const violations: IViolation[] = [];
    const files = [
      ...ctx.glob('packages/*/src/**/*.ts'),
      ...ctx.glob('packages/*/src/**/*.tsx'),
      ...ctx.glob('apps/*/src/**/*.ts'),
      ...ctx.glob('apps/*/src/**/*.tsx'),
    ];
    for (const f of files) {
      if (f.endsWith('.test.ts') || f.endsWith('.test.tsx')) continue;
      const fromRank = importerRank(f);
      if (fromRank === null) continue;
      const body = ctx.read(f) ?? '';
      for (const m of body.matchAll(/from\s+['"]@nightcore\/([a-z0-9-]+)/g)) {
        const target = m[1];
        const toRank = RANK[target];
        if (toRank === undefined) continue; // unranked leaf util
        if (toRank >= fromRank) {
          const kind = toRank === fromRank ? 'sideways' : 'upward';
          violations.push({
            file: f,
            rule: 'layer-rank',
            message: `Forbidden ${kind} import: @nightcore/${target} (rank ${toRank}) from a rank-${fromRank} module. Allowed direction: contracts -> shared -> storage/skills -> engine -> surfaces. Add a façade/bridge seam instead of a new edge.`,
          });
        }
      }
    }
    return violations;
  },
};
