/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { NightcoreEvent } from '@nightcore/contracts';
import {
  mapAssistantError,
  translateMessage,
  type SDKMessage,
} from './sdk-adapter.js';

const SID = 7;

/** Minimal SDK message fixtures. `translateMessage` is defensive and reads only
 *  a handful of fields, so we cast partial shapes through `unknown`. */
function sdk(msg: Record<string, unknown>): SDKMessage {
  return msg as unknown as SDKMessage;
}

describe('translateMessage — system init', () => {
  test('emits session-ready and surfaces the SDK session id', () => {
    const result = translateMessage(
      SID,
      sdk({
        type: 'system',
        subtype: 'init',
        session_id: 'sdk-uuid-1',
        model: 'claude-opus-4-8',
        tools: ['Read', 'Bash'],
      }),
    );
    expect(result.sdkSessionId).toBe('sdk-uuid-1');
    expect(result.events).toEqual([
      {
        type: 'session-ready',
        sessionId: SID,
        sdkSessionId: 'sdk-uuid-1',
        model: 'claude-opus-4-8',
        tools: ['Read', 'Bash'],
      },
    ]);
  });

  test('ignores non-init system subtypes', () => {
    const result = translateMessage(
      SID,
      sdk({ type: 'system', subtype: 'compact_boundary' }),
    );
    expect(result.events).toEqual([]);
    expect(result.sdkSessionId).toBeUndefined();
  });
});

describe('translateMessage — assistant message blocks', () => {
  test('maps a text block to a non-partial assistant-delta', () => {
    const result = translateMessage(
      SID,
      sdk({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hello world' }] },
      }),
    );
    expect(result.events).toEqual([
      { type: 'assistant-delta', sessionId: SID, text: 'hello world', partial: false },
    ]);
  });

  test('drops empty text blocks', () => {
    const result = translateMessage(
      SID,
      sdk({ type: 'assistant', message: { content: [{ type: 'text', text: '' }] } }),
    );
    expect(result.events).toEqual([]);
  });

  test('maps a tool_use block to tool-use-requested', () => {
    const result = translateMessage(
      SID,
      sdk({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'ls' } },
          ],
        },
      }),
    );
    expect(result.events).toEqual([
      {
        type: 'tool-use-requested',
        sessionId: SID,
        toolUseId: 'tu_1',
        toolName: 'Bash',
        input: { command: 'ls' },
      },
    ]);
  });

  test('defaults missing tool input to an empty object', () => {
    const result = translateMessage(
      SID,
      sdk({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'tu_2', name: 'Read' }] },
      }),
    );
    const event = result.events[0] as Extract<
      NightcoreEvent,
      { type: 'tool-use-requested' }
    >;
    expect(event.input).toEqual({});
  });

  test('emits multiple events in order for a mixed-block message', () => {
    const result = translateMessage(
      SID,
      sdk({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'thinking' },
            { type: 'tool_use', id: 'tu_3', name: 'Grep', input: { q: 'x' } },
          ],
        },
      }),
    );
    expect(result.events.map((e) => e.type)).toEqual([
      'assistant-delta',
      'tool-use-requested',
    ]);
  });

  test('tolerates a non-array content payload', () => {
    const result = translateMessage(
      SID,
      sdk({ type: 'assistant', message: { content: 'a bare string' } }),
    );
    expect(result.events).toEqual([]);
  });
});

describe('translateMessage — stream events', () => {
  test('maps a text_delta to a partial assistant-delta', () => {
    const result = translateMessage(
      SID,
      sdk({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'chunk' } },
      }),
    );
    expect(result.events).toEqual([
      { type: 'assistant-delta', sessionId: SID, text: 'chunk', partial: true },
    ]);
  });

  test('ignores empty text deltas', () => {
    const result = translateMessage(
      SID,
      sdk({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '' } },
      }),
    );
    expect(result.events).toEqual([]);
  });

  test('ignores unrelated stream events', () => {
    const result = translateMessage(
      SID,
      sdk({ type: 'stream_event', event: { type: 'message_start' } }),
    );
    expect(result.events).toEqual([]);
  });
});

describe('translateMessage — result (terminal)', () => {
  test('maps a success result to session-completed and a completed terminal', () => {
    const result = translateMessage(
      SID,
      sdk({
        type: 'result',
        subtype: 'success',
        result: 'all done',
        total_cost_usd: 0.42,
        num_turns: 5,
      }),
    );
    expect(result.events).toEqual([
      {
        type: 'session-completed',
        sessionId: SID,
        result: 'all done',
        costUsd: 0.42,
        numTurns: 5,
      },
    ]);
    expect(result.terminal).toEqual({
      kind: 'completed',
      result: 'all done',
      costUsd: 0.42,
      numTurns: 5,
    });
  });

  test('maps error_max_turns to a max-turns failure', () => {
    const result = translateMessage(
      SID,
      sdk({ type: 'result', subtype: 'error_max_turns', errors: ['hit the cap'] }),
    );
    expect(result.events).toEqual([
      { type: 'session-failed', sessionId: SID, reason: 'max-turns', message: 'hit the cap' },
    ]);
    expect(result.terminal).toEqual({
      kind: 'failed',
      reason: 'max-turns',
      message: 'hit the cap',
    });
  });

  test('maps a generic execution error to an unknown failure', () => {
    const result = translateMessage(
      SID,
      sdk({ type: 'result', subtype: 'error_during_execution', errors: [] }),
    );
    const event = result.events[0] as Extract<
      NightcoreEvent,
      { type: 'session-failed' }
    >;
    expect(event.reason).toBe('unknown');
    // Empty errors array falls back to the subtype as the message.
    expect(event.message).toBe('error_during_execution');
  });

  test('joins multiple error strings into one message', () => {
    const result = translateMessage(
      SID,
      sdk({ type: 'result', subtype: 'error_during_execution', errors: ['a', 'b'] }),
    );
    const event = result.events[0] as Extract<
      NightcoreEvent,
      { type: 'session-failed' }
    >;
    expect(event.message).toBe('a; b');
  });
});

describe('translateMessage — unknown message types', () => {
  test('returns no events for an unhandled type', () => {
    const result = translateMessage(SID, sdk({ type: 'auth_status' }));
    expect(result.events).toEqual([]);
    expect(result.terminal).toBeUndefined();
  });
});

describe('mapAssistantError', () => {
  type Reason = ReturnType<typeof mapAssistantError>;
  const cases: ReadonlyArray<readonly [string | undefined, Reason]> = [
    ['authentication_failed', 'authentication'],
    ['oauth_org_not_allowed', 'authentication'],
    ['rate_limit', 'rate-limit'],
    ['overloaded', 'rate-limit'],
    ['max_output_tokens', 'max-turns'],
    ['server_error', 'unknown'],
    [undefined, 'unknown'],
  ];
  test.each(cases)('maps %p to %p', (input, expected) => {
    expect(mapAssistantError(input)).toBe(expected);
  });
});
