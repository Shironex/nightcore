/**
 * @nightcore/skills — placeholder for Nightcore skill / subagent presets.
 *
 * A "skill" maps onto the SDK's `AgentDefinition` (own prompt, tools, model,
 * permission mode), invoked via the SDK's `Agent` tool. For the foundation this
 * is an empty, typed registry; presets get fleshed out once the thin core
 * proves out (see docs/architecture.md — deferred).
 *
 * Imports `contracts` only — never the engine (dependency inversion).
 */

/** A Nightcore skill preset. Structurally compatible with the SDK's
 *  `AgentDefinition`, re-declared here so this package stays SDK-free. */
export interface SkillDefinition {
  /** Skill name, invoked as a subagent. */
  name: string;
  /** One-line description shown to the orchestrator model. */
  description: string;
  /** System prompt for the skill. */
  prompt: string;
  /** Optional tool allowlist for the skill. */
  tools?: string[];
  /** Optional model override. */
  model?: string;
}

/** The registered skills. Empty for the foundation. */
export const nightcoreSkills: SkillDefinition[] = [];
