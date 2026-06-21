// @ts-check
/**
 * tools/lint-meta — frontend layer-boundary enforcement for apps/web.
 *
 * This is the deferred `tools/lint-meta` port referenced by eslint.config.mjs.
 * It encodes the feature-folder boundaries from the shiranami convention as a
 * set of flat-config blocks built on ESLint's `no-restricted-imports`:
 *
 *   1. Features must not cross-import each other. A file under
 *      `apps/web/src/features/<A>/` may not import from `features/<B>/`.
 *      Shared code belongs in `shared/`.
 *   2. Only `bridge.ts` may import `@tauri-apps/api`. It is the single Tauri
 *      seam; every other module talks to the core through it.
 *   3. `shared/ui` must not import from `features/*`. Primitives are leaves of
 *      the dependency graph — features depend on shared, never the reverse.
 *
 * Pure ESLint built-ins, no plugin dependency, so it works in the project's
 * minimal flat config.
 *
 * Flat-config note: `no-restricted-imports` does NOT merge across blocks — for
 * a given file the last matching block's rule config wins. So each block below
 * carries the FULL set of bans that apply to its files (e.g. the per-feature
 * blocks repeat the Tauri-seam ban), rather than relying on a broad block to
 * also cover feature files.
 */

/** The feature folders under apps/web/src/features. Keep in sync with the tree. */
const FEATURES = ['board', 'projects', 'settings', 'new-project'];

const WEB = 'apps/web/src';

const TAURI_GROUP = ['@tauri-apps/api', '@tauri-apps/api/*'];
const TAURI_MESSAGE =
  'Only bridge.ts may import @tauri-apps/api. Route Tauri commands/events through the bridge seam.';

/**
 * The SDK ban from the base config. Repeated here because `no-restricted-imports`
 * does not merge: these per-file web blocks override the broad `apps/**` block,
 * so the SDK ban must travel with them to stay in force inside apps/web.
 */
const SDK_PATH = {
  name: '@anthropic-ai/claude-agent-sdk',
  message:
    'Surfaces must not import the Claude Agent SDK directly. Go through @nightcore/engine.',
};

/**
 * Import patterns matching a given feature, in alias (`@/features/<f>`) and
 * relative (glob `features/<f>`) forms.
 * @param {string} feature
 * @returns {string[]}
 */
function featureImportPatterns(feature) {
  return [
    // Sibling relative form from within another feature dir: `../<feature>`.
    `../${feature}`,
    `../${feature}/**`,
    // Deep relative form: `../../features/<feature>`.
    `**/features/${feature}`,
    `**/features/${feature}/**`,
    // Path-alias form: `@/features/<feature>`.
    `@/features/${feature}`,
    `@/features/${feature}/**`,
  ];
}

/**
 * Block 1 — per feature: forbid importing the *other* features, and (since this
 * block wins for these files) re-assert the Tauri-seam ban.
 */
const crossFeatureBlocks = FEATURES.map((feature) => {
  const others = FEATURES.filter((f) => f !== feature);
  return {
    files: [`${WEB}/features/${feature}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [SDK_PATH],
          patterns: [
            {
              group: others.flatMap(featureImportPatterns),
              message:
                'Features must not import each other. Lift shared code into shared/ (the cross-feature import boundary).',
            },
            { group: TAURI_GROUP, message: TAURI_MESSAGE },
          ],
        },
      ],
    },
  };
});

/** Block 2 — every web file except bridge.ts: forbid the Tauri API. */
const tauriSeamBlock = {
  files: [`${WEB}/**/*.{ts,tsx}`],
  ignores: [
    `${WEB}/bridge.ts`,
    `${WEB}/features/**`,
    `${WEB}/shared/**`,
  ],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [SDK_PATH],
        patterns: [{ group: TAURI_GROUP, message: TAURI_MESSAGE }],
      },
    ],
  },
};

/** Block 3 — shared/**: forbid importing features and the Tauri API. */
const sharedPurityBlock = {
  files: [`${WEB}/shared/**/*.{ts,tsx}`],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [SDK_PATH],
        patterns: [
          {
            group: ['**/features/*', '**/features/**', '@/features/*', '@/features/**'],
            message:
              'shared/ must not import from features/. Primitives are leaves — features depend on shared, never the reverse.',
          },
          { group: TAURI_GROUP, message: TAURI_MESSAGE },
        ],
      },
    ],
  },
};

/**
 * The flat-config blocks enforcing the frontend layer boundaries.
 * Spread into the root eslint.config.mjs.
 * @type {import('eslint').Linter.Config[]}
 */
export const layerRules = [
  ...crossFeatureBlocks,
  tauriSeamBlock,
  sharedPurityBlock,
];

export default layerRules;
