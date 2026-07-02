// @ts-check
import type { IMetaRule, IViolation } from '../types';

/**
 * Decision-register integrity. `docs/decisions/INDEX.md` claims to be the single
 * canonical, drift-free list of architectural decisions. This rule keeps that
 * claim honest by checking every data row (`| D-NNN | date | decision | status |
 * source |`):
 *   (a) every repo path it cites (Decision or Source column) resolves on disk —
 *       a stale/moved path fails CI (e.g. D-003's old sdk-adapter.ts location);
 *   (b) the Date column is non-empty (never `—`/`-`) — every decision is dated;
 *   (c) every dated decision doc under `docs/decisions/` is linked from a row.
 *
 * Only genuine repo paths are checked: a token counts as a path only when it
 * starts with a known top-level dir (docs/ packages/ apps/ tools/ scripts/
 * design/), so npm scopes (`@nightcore/*`) and dotted identifiers
 * (`Options.mcpServers`) are never mistaken for files.
 */
const PATH_TOKEN =
  /^(?:docs|packages|apps|tools|scripts|design)\/[A-Za-z0-9._/-]+$/;
const DATED_DOC = /(?:^|\/)\d{4}-\d{2}-\d{2}-[^/]+\.md$/;

function pathTokens(text: string): string[] {
  const tokens = new Set<string>();
  for (const m of text.matchAll(/`([^`]+)`/g)) tokens.add(m[1].trim());
  for (const raw of text.split(/[\s,()]+/)) tokens.add(raw.trim());
  return Array.from(tokens).filter((t) => PATH_TOKEN.test(t));
}

export const decisionRegisterIntegrityRule: IMetaRule = {
  id: 'decision-register-integrity',
  category: 'source-text',
  ciCritical: true,
  description:
    'docs/decisions/INDEX.md rows must cite resolvable paths, carry a date, and link every dated decision doc under docs/decisions/.',
  run(ctx) {
    const REGISTER = 'docs/decisions/INDEX.md';
    const raw = ctx.read(REGISTER);
    if (raw === null) return [];
    const violations: IViolation[] = [];

    for (const line of raw.split('\n').filter((l) => /^\|\s*D-\d+/.test(l))) {
      const cols = line.split('|').map((c) => c.trim());
      const id = cols[1] ?? '';
      const date = cols[2] ?? '';
      const decision = cols[3] ?? '';
      const source = cols[5] ?? '';

      if (date === '' || date === '—' || date === '-') {
        violations.push({
          file: REGISTER,
          rule: 'decision-register-integrity',
          message: `Row ${id} has no date. Every decision must carry a YYYY-MM-DD date in the Date column.`,
        });
      }

      for (const token of pathTokens(`${decision} ${source}`)) {
        if (!ctx.exists(token)) {
          violations.push({
            file: REGISTER,
            rule: 'decision-register-integrity',
            message: `Row ${id} cites '${token}', which does not exist on disk. Fix the path or update the decision.`,
          });
        }
      }
    }

    for (const doc of ctx.glob('docs/decisions/**/*.md')) {
      if (!DATED_DOC.test(doc)) continue;
      const base = doc.split('/').pop() ?? doc;
      if (!raw.includes(doc) && !raw.includes(base)) {
        violations.push({
          file: doc,
          rule: 'decision-register-integrity',
          message: `Dated decision doc '${doc}' is not linked from any row in ${REGISTER}. Add a register row that cites it.`,
        });
      }
    }

    return violations;
  },
};
