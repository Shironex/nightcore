import { z } from 'zod';

/**
 * How risky a tool is, which drives how tightly the PermissionLayer gates it:
 *  - `safe`      — read-only; may be auto-allowed.
 *  - `mutating`  — writes/edits state; gated by mode + allow/deny.
 *  - `dangerous` — arbitrary effect (shell exec, network); ALWAYS requires
 *                  interactive approval unless explicitly allow-listed, even
 *                  under an auto-accepting mode.
 */
export const ToolRiskSchema = z.enum(['safe', 'mutating', 'dangerous']);
export type ToolRisk = z.infer<typeof ToolRiskSchema>;

/**
 * Describes a tool the harness can surface to a session. This is Nightcore's own
 * descriptor — the actual executable definition (a zod shape + handler) lives in
 * `@nightcore/tools` and is assembled into an in-process SDK MCP server by the
 * engine's ToolRegistry. The descriptor is the metadata the surface can render.
 */
export const ToolDescriptorSchema = z.object({
  /** Fully-qualified tool name as seen by the model (e.g. `mcp__nightcore__echo`). */
  name: z.string(),
  /** Short human description. */
  description: z.string(),
  /** Source: a built-in SDK tool, or one Nightcore registered in-process. */
  source: z.enum(['builtin', 'nightcore', 'external-mcp']),
  /** Risk class — drives permission gating. When omitted, the PermissionLayer
   *  treats the tool as the most cautious class (`dangerous`). */
  risk: ToolRiskSchema.optional(),
  /** Deprecated: superseded by `risk`. `mutating` ≈ `risk !== 'safe'`. Kept so
   *  existing descriptors/readers don't break; prefer `risk`. */
  mutating: z.boolean().default(false),
});
export type ToolDescriptor = z.infer<typeof ToolDescriptorSchema>;

/**
 * A decision the PermissionLayer renders for a single tool-use request.
 * Mirrors the SDK's `PermissionResult` shape but in contract terms so surfaces
 * can construct approvals without importing the SDK.
 */
export const PermissionDecisionSchema = z.discriminatedUnion('behavior', [
  z.object({
    behavior: z.literal('allow'),
    /** Optionally rewrite the tool input before execution. */
    updatedInput: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    behavior: z.literal('deny'),
    /** Message returned to the model explaining the denial. */
    message: z.string(),
  }),
]);
export type PermissionDecision = z.infer<typeof PermissionDecisionSchema>;
