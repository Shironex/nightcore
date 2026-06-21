import type { TSESLint } from '@typescript-eslint/utils';

import { recommendedRules } from './configs/recommended';
import { rules } from './rules';

type NightcorePlugin = TSESLint.FlatConfig.Plugin & {
  configs: Record<string, TSESLint.FlatConfig.Config>;
};

const plugin: NightcorePlugin = {
  meta: {
    name: '@nightcore/eslint-plugin',
    version: '0.0.0',
  },
  rules,
  configs: {},
};

// Short name `nightcore` so rules read like `nightcore/<rule-name>` in flat
// config.
plugin.configs.recommended = {
  plugins: {
    nightcore: plugin,
  },
  rules: recommendedRules,
};

export { rules };
export const configs = plugin.configs;
export default plugin;
