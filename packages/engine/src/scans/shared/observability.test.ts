/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { NightcoreEvent } from '@nightcore/contracts';
import type { Logger } from '@nightcore/shared';

import { makeHeartbeat } from './observability.js';

/** A Logger whose `info` is a bun mock so we can inspect emitted heartbeat lines. */
function fakeLogger(): { logger: Logger; info: ReturnType<typeof mock> } {
  const info = mock(() => {});
  const logger = {
    debug: mock(() => {}),
    info,
    warn: mock(() => {}),
    error: mock(() => {}),
    child: mock(() => logger),
  } as unknown as Logger;
  return { logger, info };
}

/** A `tool-use-requested` event — the only kind the heartbeat counts. */
function toolUse(toolName: string, input: Record<string, unknown>): NightcoreEvent {
  return {
    type: 'tool-use-requested',
    sessionId: 1,
    toolUseId: 'tu_1',
    toolName,
    input,
  } as NightcoreEvent;
}

/** Any non-tool event — the heartbeat must ignore these entirely. */
function assistantDelta(): NightcoreEvent {
  return {
    type: 'assistant-delta',
    sessionId: 1,
    text: 'partial',
    partial: true,
  } as NightcoreEvent;
}

// The heartbeat throttles off Date.now(); a controlled clock makes the
// once-per-interval behavior deterministic instead of wall-clock-dependent.
const realNow = Date.now;
let clock = 0;
beforeEach(() => {
  clock = 1_000_000; // start well above the 3000ms interval so the first beat fires
  Date.now = () => clock;
});
afterEach(() => {
  Date.now = realNow;
});

describe('makeHeartbeat', () => {
  test('returns a no-op sink when there is no logger', () => {
    const beat = makeHeartbeat(undefined, '[insight:perf]');
    // Must swallow every event without throwing and without needing a logger.
    expect(() => beat(toolUse('Read', { file_path: 'src/a.ts' }))).not.toThrow();
    expect(() => beat(assistantDelta())).not.toThrow();
  });

  test('ignores non-tool-use events', () => {
    const { logger, info } = fakeLogger();
    const beat = makeHeartbeat(logger, '[insight:perf]');
    beat(assistantDelta());
    beat(assistantDelta());
    expect(info).toHaveBeenCalledTimes(0);
  });

  test('logs the first tool use with turn 1 and the path detail', () => {
    const { logger, info } = fakeLogger();
    const beat = makeHeartbeat(logger, '[insight:perf]');
    beat(toolUse('Read', { file_path: 'src/app.ts' }));
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]?.[0]).toBe('[insight:perf] turn 1 · Read src/app.ts');
  });

  test('throttles to at most one line per interval but keeps counting turns', () => {
    const { logger, info } = fakeLogger();
    const beat = makeHeartbeat(logger, '[insight:perf]');

    beat(toolUse('Read', { file_path: 'a.ts' })); // turn 1 → logs
    clock += 1000; // still inside the 3000ms window
    beat(toolUse('Read', { file_path: 'b.ts' })); // turn 2 → throttled
    clock += 1000;
    beat(toolUse('Read', { file_path: 'c.ts' })); // turn 3 → throttled

    expect(info).toHaveBeenCalledTimes(1);

    clock += 3000; // past the interval since the last beat
    beat(toolUse('Grep', { path: 'src/' })); // turn 4 → logs again

    expect(info).toHaveBeenCalledTimes(2);
    expect(info.mock.calls[0]?.[0]).toBe('[insight:perf] turn 1 · Read a.ts');
    expect(info.mock.calls[1]?.[0]).toBe('[insight:perf] turn 4 · Grep src/');
  });
});

describe('heartbeat tool summary (via the emitted line)', () => {
  function firstLine(toolName: string, input: unknown): string {
    const { logger, info } = fakeLogger();
    const beat = makeHeartbeat(logger, 'L');
    beat({
      type: 'tool-use-requested',
      sessionId: 1,
      toolUseId: 'tu',
      toolName,
      input,
    } as NightcoreEvent);
    return (info.mock.calls[0]?.[0] as string) ?? '';
  }

  test('uses file_path, then path, then notebook_path as the detail', () => {
    expect(firstLine('Read', { file_path: 'a.ts' })).toBe('L turn 1 · Read a.ts');
    expect(firstLine('Grep', { path: 'b.ts' })).toBe('L turn 1 · Grep b.ts');
    expect(firstLine('Edit', { notebook_path: 'nb.ipynb' })).toBe(
      'L turn 1 · Edit nb.ipynb',
    );
  });

  test('omits the detail when no path-like arg is present (name only)', () => {
    // Value args like `pattern`/`command` are deliberately NOT surfaced — they can
    // carry secrets/PII — so a tool use with only those reduces to the tool name.
    expect(firstLine('Bash', { command: 'rm -rf /' })).toBe('L turn 1 · Bash');
    expect(firstLine('Grep', { pattern: 'API_KEY' })).toBe('L turn 1 · Grep');
  });

  test('treats a non-object input as having no detail', () => {
    expect(firstLine('Read', 'not-an-object')).toBe('L turn 1 · Read');
    expect(firstLine('Read', null)).toBe('L turn 1 · Read');
  });

  test('collapses internal whitespace in the path', () => {
    expect(firstLine('Read', { file_path: '  src/\t a\n b.ts  ' })).toBe(
      'L turn 1 · Read src/ a b.ts',
    );
  });

  test('truncates an overlong path to 57 chars + ellipsis', () => {
    const long = 'src/' + 'x'.repeat(80) + '.ts'; // > 60 chars
    const line = firstLine('Read', { file_path: long });
    const detail = line.replace('L turn 1 · Read ', '');
    expect(detail.length).toBe(58); // 57 chars + the ellipsis
    expect(detail.endsWith('…')).toBe(true);
    expect(detail.startsWith('src/xxx')).toBe(true);
  });
});
