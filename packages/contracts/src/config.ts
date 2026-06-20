import { z } from 'zod';

/**
 * Permission modes mirror the Claude Agent SDK's `PermissionMode` union exactly.
 * We re-declare it here (rather than importing the SDK) so that the contracts
 * package depends on nothing app-specific — surfaces and config can speak about
 * permission modes without pulling in the engine or the SDK.
 *
 * Keep in sync with `@anthropic-ai/claude-agent-sdk` `PermissionMode`.
 */
export const PermissionModeSchema = z.enum([
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
  'dontAsk',
  'auto',
]);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;

/**
 * Known Claude model ids. `model` is a free string at the SDK boundary, but the
 * harness offers these as the curated default set. Exact non-Opus ids are
 * confirmed at build time against the models doc (see docs/architecture.md).
 */
export const KnownModelSchema = z.enum([
  'claude-opus-4-8',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'claude-fable-5',
]);
export type KnownModel = z.infer<typeof KnownModelSchema>;

/**
 * Permission policy: how the harness should resolve tool-use requests before
 * falling back to interactive approval. Maps onto the SDK's allow/deny lists
 * plus the active permission mode.
 */
export const PermissionPolicySchema = z.object({
  /** Tools auto-allowed without prompting. */
  allow: z.array(z.string()).default([]),
  /** Tools always denied. */
  deny: z.array(z.string()).default([]),
  /** Default permission mode for new sessions. */
  mode: PermissionModeSchema.default('default'),
});
export type PermissionPolicy = z.infer<typeof PermissionPolicySchema>;

/**
 * Resolved paths the harness reads/writes. Computed by `@nightcore/config` from
 * the home dir and the project root; surfaced here so any layer can reason about
 * them via the contract rather than recomputing.
 */
export const ConfigPathsSchema = z.object({
  /** `~/.nightcore` — global user state. */
  home: z.string(),
  /** Per-project `.nightcore` directory, when inside a project. */
  project: z.string().optional(),
  /** Where session metadata is persisted (under `home`). */
  sessions: z.string(),
});
export type ConfigPaths = z.infer<typeof ConfigPathsSchema>;

/**
 * The layered Nightcore configuration. Built by merging:
 * defaults → `~/.nightcore/config.json` → `./.nightcore/config.json`.
 */
export const ConfigSchema = z.object({
  /** Default model for new sessions. Free string to allow any SDK-supported id. */
  model: z.string().default('claude-opus-4-8'),
  /** Permission policy applied to new sessions. */
  permissions: PermissionPolicySchema.prefault({}),
  /** Resolved filesystem paths. */
  paths: ConfigPathsSchema,
  /** Log verbosity. */
  logLevel: z.enum(['silent', 'error', 'warn', 'info', 'debug']).default('info'),
});
export type Config = z.infer<typeof ConfigSchema>;

/**
 * The user-authored portion of config (everything except resolved `paths`,
 * which the resolver computes). This is what lives in the on-disk JSON files.
 */
export const ConfigFileSchema = ConfigSchema.omit({ paths: true }).partial();
export type ConfigFile = z.infer<typeof ConfigFileSchema>;
