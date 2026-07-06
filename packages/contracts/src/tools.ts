import { z } from 'zod';

/** Tool-risk classification and permission/question reply shapes. */

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

/**
 * A surface's reply to a `question-required` event (the SDK's `AskUserQuestion`).
 * Parallel to `PermissionDecisionSchema` but for a Q&A dialog rather than a
 * tool allow/deny:
 *  - `answer` — the user answered; `answers` maps each question's prompt text to
 *    the chosen option label OR a free-text custom answer (the engine folds this
 *    into the SDK dialog reply's `updatedInput.answers`).
 *  - `cancel` — the user dismissed/skipped; the engine settles the SDK dialog as
 *    `cancelled`, so the model proceeds without an answer (the SDK default).
 */
export const QuestionAnswerSchema = z.discriminatedUnion('behavior', [
  z.object({
    behavior: z.literal('answer'),
    /** Question prompt text → chosen option label or free-text answer. For a
     *  multiSelect question the value is the selected labels joined with `, `. */
    answers: z.record(z.string(), z.string()),
  }),
  z.object({
    behavior: z.literal('cancel'),
  }),
]);
export type QuestionAnswer = z.infer<typeof QuestionAnswerSchema>;
