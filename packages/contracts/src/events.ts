import { z } from 'zod';
import { PermissionModeSchema } from './config.js';
import { SessionStatusSchema } from './session.js';
import { ToolRiskSchema } from './tools.js';

/**
 * `NightcoreEvent` — the typed stream flowing engine → surface.
 *
 * The SessionRunner translates each raw `SDKMessage` into one of these. Every
 * event carries `sessionId` (Nightcore's monotonic id) so a single surface can
 * multiplex several concurrent sessions. This union is the entire contract a
 * surface needs to render a session — surfaces never see `SDKMessage`.
 */

const base = {
  /** Monotonic Nightcore session id this event belongs to. */
  sessionId: z.number().int().nonnegative(),
};

/** Session accepted and the SDK subprocess is warming up. */
export const SessionStartedEvent = z.object({
  ...base,
  type: z.literal('session-started'),
  prompt: z.string(),
  model: z.string(),
  permissionMode: PermissionModeSchema,
});

/** The SDK emitted its `init` system message; carries the real SDK session id. */
export const SessionReadyEvent = z.object({
  ...base,
  type: z.literal('session-ready'),
  sdkSessionId: z.string(),
  model: z.string(),
  tools: z.array(z.string()),
});

/** A chunk of assistant text. For streamed deltas, `text` is the incremental
 *  piece; for whole-message fallbacks it is the full block. */
export const AssistantDeltaEvent = z.object({
  ...base,
  type: z.literal('assistant-delta'),
  text: z.string(),
  /** True when this is an incremental stream chunk vs a whole message block. */
  partial: z.boolean(),
});

/** The model requested a tool call. */
export const ToolUseRequestedEvent = z.object({
  ...base,
  type: z.literal('tool-use-requested'),
  toolUseId: z.string(),
  toolName: z.string(),
  input: z.record(z.string(), z.unknown()),
});

/** A tool finished and produced a result (or error). */
export const ToolResultEvent = z.object({
  ...base,
  type: z.literal('tool-result'),
  toolUseId: z.string(),
  isError: z.boolean(),
  /** Stringified result content for display. */
  content: z.string(),
});

/** The harness needs an interactive approval decision for a tool call. The
 *  surface responds with an `approve-permission` command carrying `requestId`. */
export const PermissionRequiredEvent = z.object({
  ...base,
  type: z.literal('permission-required'),
  requestId: z.string(),
  toolName: z.string(),
  input: z.record(z.string(), z.unknown()),
  /** Risk class of the requested tool, so the surface can badge dangerous calls
   *  (e.g. shell exec). Absent when the tool has no Nightcore descriptor. */
  risk: ToolRiskSchema.optional(),
  /** Pre-rendered prompt sentence from the SDK, when available. */
  title: z.string().optional(),
});

/** Session reached a successful terminal state. */
export const SessionCompletedEvent = z.object({
  ...base,
  type: z.literal('session-completed'),
  /** The final result text from the SDK result message. */
  result: z.string(),
  costUsd: z.number(),
  numTurns: z.number().int(),
});

/** Session failed or the runner crashed. Degrade-not-throw: the manager always
 *  emits this rather than rejecting, mirroring shiranami's `failAllPending`. */
export const SessionFailedEvent = z.object({
  ...base,
  type: z.literal('session-failed'),
  /** Stable failure reason for the surface to branch on. */
  reason: z.enum([
    'authentication',
    'rate-limit',
    'aborted',
    'runner-crash',
    'max-turns',
    'unknown',
  ]),
  message: z.string(),
});

/** Session status transitioned (for surfaces that render a status line). */
export const SessionStatusEvent = z.object({
  ...base,
  type: z.literal('session-status'),
  status: SessionStatusSchema,
});

export const NightcoreEventSchema = z.discriminatedUnion('type', [
  SessionStartedEvent,
  SessionReadyEvent,
  AssistantDeltaEvent,
  ToolUseRequestedEvent,
  ToolResultEvent,
  PermissionRequiredEvent,
  SessionCompletedEvent,
  SessionFailedEvent,
  SessionStatusEvent,
]);
export type NightcoreEvent = z.infer<typeof NightcoreEventSchema>;

/** Convenience map from event `type` to its inferred TS shape. */
export type NightcoreEventOf<T extends NightcoreEvent['type']> = Extract<
  NightcoreEvent,
  { type: T }
>;
