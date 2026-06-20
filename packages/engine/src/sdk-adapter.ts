/**
 * The single boundary file where the Claude Agent SDK is imported broadly. The
 * rest of the engine speaks `NightcoreEvent` / contract types; only this module
 * knows the SDK's `SDKMessage` shapes. Centralizing the import keeps the SDK API
 * surface (which drifts across versions) confined to one place.
 */
import type {
  Options,
  PermissionMode,
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { NightcoreEvent } from '@nightcore/contracts';

export type { Options, PermissionMode, Query, SDKMessage, SDKUserMessage };
export { query };

/** Map an `SDKAssistantMessageError` onto a stable Nightcore failure reason. */
export function mapAssistantError(
  error: string | undefined,
): NightcoreEventOfReason {
  switch (error) {
    case 'authentication_failed':
    case 'oauth_org_not_allowed':
      return 'authentication';
    case 'rate_limit':
    case 'overloaded':
      return 'rate-limit';
    case 'max_output_tokens':
      return 'max-turns';
    default:
      return 'unknown';
  }
}

type NightcoreEventOfReason = Extract<
  NightcoreEvent,
  { type: 'session-failed' }
>['reason'];

/** A minimal text content block. */
interface TextBlock {
  type: 'text';
  text: string;
}
/** A minimal tool_use content block. */
interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

function isTextBlock(block: unknown): block is TextBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'text' &&
    typeof (block as { text?: unknown }).text === 'string'
  );
}

function isToolUseBlock(block: unknown): block is ToolUseBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'tool_use'
  );
}

/**
 * Translate one raw `SDKMessage` into zero or more `NightcoreEvent`s for a given
 * Nightcore session id. Returns the events plus optional side-channel signals
 * (the SDK session id from `init`, terminal result data) the runner acts on.
 *
 * This is intentionally pure and synchronous so it is trivially unit-testable
 * without spawning the SDK.
 */
export function translateMessage(
  sessionId: number,
  msg: SDKMessage,
): TranslateResult {
  switch (msg.type) {
    case 'system':
      return translateSystem(sessionId, msg);
    case 'assistant':
      return { events: translateAssistant(sessionId, msg) };
    case 'stream_event':
      return { events: translateStreamEvent(sessionId, msg) };
    case 'result':
      return translateResult(sessionId, msg);
    default:
      // Many SDK message subtypes (status, hooks, task progress, etc.) carry no
      // surface-relevant payload for the foundation — ignore them.
      return { events: [] };
  }
}

export interface TranslateResult {
  events: NightcoreEvent[];
  /** Set when the SDK emits its `init` system message. */
  sdkSessionId?: string;
  /** Set on a terminal `result` message. */
  terminal?:
    | { kind: 'completed'; result: string; costUsd: number; numTurns: number }
    | { kind: 'failed'; reason: NightcoreEventOfReason; message: string };
}

function translateSystem(
  sessionId: number,
  msg: Extract<SDKMessage, { type: 'system' }>,
): TranslateResult {
  if (msg.subtype === 'init') {
    return {
      events: [
        {
          type: 'session-ready',
          sessionId,
          sdkSessionId: msg.session_id,
          model: msg.model,
          tools: msg.tools,
        },
      ],
      sdkSessionId: msg.session_id,
    };
  }
  return { events: [] };
}

function translateAssistant(
  sessionId: number,
  msg: Extract<SDKMessage, { type: 'assistant' }>,
): NightcoreEvent[] {
  const events: NightcoreEvent[] = [];
  const content = (msg.message as { content?: unknown }).content;
  const blocks = Array.isArray(content) ? content : [];

  for (const block of blocks) {
    if (isTextBlock(block) && block.text.length > 0) {
      events.push({
        type: 'assistant-delta',
        sessionId,
        text: block.text,
        partial: false,
      });
    } else if (isToolUseBlock(block)) {
      events.push({
        type: 'tool-use-requested',
        sessionId,
        toolUseId: block.id,
        toolName: block.name,
        input: block.input ?? {},
      });
    }
  }
  return events;
}

function translateStreamEvent(
  sessionId: number,
  msg: Extract<SDKMessage, { type: 'stream_event' }>,
): NightcoreEvent[] {
  const event = msg.event as {
    type?: string;
    delta?: { type?: string; text?: string };
  };
  if (
    event.type === 'content_block_delta' &&
    event.delta?.type === 'text_delta' &&
    typeof event.delta.text === 'string' &&
    event.delta.text.length > 0
  ) {
    return [
      {
        type: 'assistant-delta',
        sessionId,
        text: event.delta.text,
        partial: true,
      },
    ];
  }
  return [];
}

function translateResult(
  sessionId: number,
  msg: Extract<SDKMessage, { type: 'result' }>,
): TranslateResult {
  if (msg.subtype === 'success') {
    return {
      events: [
        {
          type: 'session-completed',
          sessionId,
          result: msg.result,
          costUsd: msg.total_cost_usd,
          numTurns: msg.num_turns,
        },
      ],
      terminal: {
        kind: 'completed',
        result: msg.result,
        costUsd: msg.total_cost_usd,
        numTurns: msg.num_turns,
      },
    };
  }

  const reason: NightcoreEventOfReason =
    msg.subtype === 'error_max_turns' ? 'max-turns' : 'unknown';
  const message = msg.errors.join('; ') || msg.subtype;
  return {
    events: [
      { type: 'session-failed', sessionId, reason, message },
    ],
    terminal: { kind: 'failed', reason, message },
  };
}
