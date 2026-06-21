import type { TSESLint } from '@typescript-eslint/utils';

/**
 * The component-architecture rules ship 'off' in `recommended`. They are wired
 * on, scoped to `apps/web/src/components/**`, in the root `eslint.config.mjs`
 * (the Tier-C block) — the same pattern shiranami uses. Registering them here
 * keeps the plugin's rule namespace discoverable without forcing the convention
 * onto consumers that haven't migrated.
 */
export const recommendedRules: TSESLint.FlatConfig.Rules = {
  'nightcore/component-folder-structure': 'off',
  'nightcore/no-state-in-component-body': 'off',
  'nightcore/no-cross-feature-imports': 'off',
  'nightcore/max-hooks-per-file': 'off',
};
