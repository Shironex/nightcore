// @ts-check
import type { IMetaRule, IViolation } from '../types';

/**
 * Severity is `error` or `off`, never `warn`. Agents iterate by reading CI
 * failures; a warning is a silent miss an agent will not act on. This scans the
 * flat config text for any `'warn'`/`"warn"` severity literal (comments stripped).
 */
export const noWarnSeverityRule: IMetaRule = {
  id: 'no-warn-severity',
  category: 'config',
  ciCritical: true,
  description:
    "ESLint severity is 'error' or 'off', never 'warn'. A rule that matters is an error; a failure is fixed, not silenced.",
  run(ctx) {
    const config = ctx.read('eslint.config.mjs');
    if (config === null) return [];
    const violations: IViolation[] = [];
    config.split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (/['"]warn['"]/.test(code)) {
        violations.push({
          file: 'eslint.config.mjs',
          rule: 'no-warn-severity',
          message: `Line ${i + 1}: ESLint 'warn' severity is forbidden — use 'error' or 'off'.`,
        });
      }
    });
    return violations;
  },
};
