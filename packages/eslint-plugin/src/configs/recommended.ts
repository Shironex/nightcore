import type { TSESLint } from '@typescript-eslint/utils';

/**
 * `enforce-context-consumption` ships 'off' in `recommended`. It is wired on,
 * scoped to the board feature, in the root `eslint.config.mjs`. Registering it
 * here keeps the plugin's rule namespace discoverable without forcing the
 * convention onto consumers that haven't migrated.
 *
 * The other component-architecture rules moved to the published
 * `@noctcore/eslint-plugin-*` packages (react / architecture / monorepo /
 * contracts) and are no longer part of this local plugin.
 */
export const recommendedRules: TSESLint.FlatConfig.Rules = {
  'nightcore/enforce-context-consumption': 'off',
};
