/**
 * Adapts the SDK-free `@nightcore/skills` presets into the SDK's
 * `Options.agents` shape (`Record<string, AgentDefinition>`, keyed by name).
 *
 * `@nightcore/skills` deliberately re-declares the agent shape structurally so
 * it never imports the SDK; this module is the single seam that maps it onto the
 * real `AgentDefinition` type, keeping the SDK import confined to the engine.
 */
import { nightcoreSkills, type SkillDefinition } from '@nightcore/skills';
import type { AgentDefinition } from './sdk-adapter.js';

function toAgentDefinition(skill: SkillDefinition): AgentDefinition {
  return {
    description: skill.description,
    prompt: skill.prompt,
    ...(skill.tools !== undefined ? { tools: skill.tools } : {}),
    ...(skill.model !== undefined ? { model: skill.model } : {}),
  };
}

/** Nightcore's built-in subagent presets, keyed by name for `Options.agents`. */
export const nightcoreAgents: Record<string, AgentDefinition> =
  Object.fromEntries(
    nightcoreSkills.map((skill) => [skill.name, toAgentDefinition(skill)]),
  );
