// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import { layerRules } from './tools/lint-meta/index.mjs';

/**
 * Flat config. The `no-restricted-imports` blocks encode the layer-dependency
 * rules from the architecture doc (§3 table): surfaces and capability packages
 * must never reach for the SDK or the engine directly.
 *
 * The fine-grained frontend layer enforcement (feature-folder boundaries, the
 * single Tauri seam, shared/ purity) lives in `tools/lint-meta` and is spread
 * in as `layerRules` at the end. See tools/lint-meta/README.md.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-tsc/**',
      '**/target/**',
      '**/node_modules/**',
      '**/*.tsbuildinfo',
      '**/storybook-static/**',
      '**/*.woff2',
      'design/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Surfaces (apps/*) may not import the SDK directly — only the engine façade.
    files: ['apps/**/*.ts', 'apps/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@anthropic-ai/claude-agent-sdk',
              message:
                'Surfaces must not import the Claude Agent SDK directly. Go through @nightcore/engine.',
            },
          ],
        },
      ],
    },
  },
  {
    // Capability packages (tools/skills/mcp) must never reach up into the engine.
    files: [
      'packages/tools/**/*.ts',
      'packages/skills/**/*.ts',
      'packages/mcp/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@nightcore/engine', '@nightcore/engine/*'],
              message:
                'Capability packages must not import the engine (dependency inversion — the engine pulls them in).',
            },
          ],
        },
      ],
    },
  },
  // Frontend layer boundaries (feature isolation, Tauri seam, shared/ purity).
  ...layerRules,
);
