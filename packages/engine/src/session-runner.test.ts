/// <reference types="bun" />
import { describe, expect, mock, test } from 'bun:test';
import type {
  McpServerEntry,
  NightcoreEvent,
  PermissionPolicy,
  SettingSource,
} from '@nightcore/contracts';

/**
 * The Claude CLI is a REQUIRED, user-installed prerequisite — Nightcore does not
 * bundle it. `resolveClaudeBinary()` returns the on-disk path or `undefined` when
 * nothing resolves. We stub it here so a test can force the empty-resolution case
 * (no `claude` installed) without touching the real filesystem, and the resolved
 * case without depending on a `claude` being present on the test machine.
 */
let resolvedClaudePath: string | undefined;
mock.module('./resolve-claude-binary.js', () => ({
  resolveClaudeBinary: () => resolvedClaudePath,
}));

/**
 * Stub the SDK boundary so the resolved-path (happy) case never spawns a live
 * model: a `query()` that yields no messages and completes immediately. The
 * preflight runs BEFORE `query()` is ever called, so the empty-resolution case
 * never reaches this stub at all.
 */
const realSdk = await import('@anthropic-ai/claude-agent-sdk');
let queryCalls = 0;
mock.module('@anthropic-ai/claude-agent-sdk', () => ({
  ...realSdk,
  query: () => {
    queryCalls += 1;
    const iterator: AsyncGenerator<unknown> = {
      async next() {
        return { value: undefined, done: true };
      },
      async return() {
        return { value: undefined, done: true };
      },
      async throw(e) {
        throw e;
      },
      [Symbol.asyncIterator]() {
        return iterator;
      },
    };
    return Object.assign(iterator, {
      async interrupt() {},
      async setModel() {},
      async setPermissionMode() {},
    });
  },
}));

// Imported AFTER the mocks are registered so the runner picks up the stubs.
const { SessionRunner, toSdkMcpServers } = await import('./session-runner.js');

const policy: PermissionPolicy = { allow: [], deny: [], mode: 'default' };
const settingSources: SettingSource[] = [];

function makeRunner(emit: (event: NightcoreEvent) => void) {
  return new SessionRunner(
    {
      sessionId: 1,
      prompt: 'hi',
      model: 'claude-opus-4-8',
      permissionMode: 'default',
      permissionPolicy: policy,
      cwd: process.cwd(),
      apiKeyFallback: false,
      settingSources,
      todoFeatureEnabled: false,
    },
    emit,
  );
}

describe('SessionRunner — Claude CLI preflight', () => {
  test('empty resolution surfaces an actionable runner-crash session-failed', async () => {
    resolvedClaudePath = undefined;
    queryCalls = 0;
    const events: NightcoreEvent[] = [];

    // run() must resolve (degrade-not-throw), not reject, when no CLI resolves.
    await expect(makeRunner((e) => events.push(e)).run()).resolves.toBeUndefined();

    const failed = events.find((e) => e.type === 'session-failed');
    expect(failed).toBeDefined();
    if (failed?.type === 'session-failed') {
      // Reuses an existing reason — no new contract enum value was added.
      expect(failed.reason).toBe('runner-crash');
      expect(failed.message).toContain('Claude CLI not found');
      expect(failed.message).toContain('curl -fsSL https://claude.ai/install.sh | bash');
      expect(failed.message).toContain('https://code.claude.com/docs/en/setup');
    }
    // Fail FAST: the SDK is never invoked when the CLI is missing.
    expect(queryCalls).toBe(0);
  });

  test('a resolved CLI path runs normally — no preflight failure', async () => {
    resolvedClaudePath = '/usr/local/bin/claude';
    queryCalls = 0;
    const events: NightcoreEvent[] = [];

    await makeRunner((e) => events.push(e)).run();

    // Happy path is unchanged: the SDK is invoked and no CLI-missing failure fires.
    expect(queryCalls).toBe(1);
    const cliMissing = events.find(
      (e) => e.type === 'session-failed' && e.message.includes('Claude CLI not found'),
    );
    expect(cliMissing).toBeUndefined();
  });
});

describe('toSdkMcpServers — contract → SDK Options.mcpServers', () => {
  const stdio = (
    id: string,
    name: string,
    enabled: boolean,
    extra: Partial<{ args: string[]; env: Record<string, string> }> = {},
  ): McpServerEntry => ({
    id,
    name,
    enabled,
    config: {
      transport: 'stdio',
      command: 'npx',
      args: extra.args ?? [],
      env: extra.env ?? {},
    },
  });

  test('an absent or empty list yields undefined (the key is omitted)', () => {
    // Byte-identical to the pre-feature options: no `mcpServers` key at all.
    expect(toSdkMcpServers(undefined)).toBeUndefined();
    expect(toSdkMcpServers([])).toBeUndefined();
  });

  test('a list of only-disabled entries yields undefined', () => {
    expect(toSdkMcpServers([stdio('a', 'alpha', false)])).toBeUndefined();
  });

  test('disabled entries are dropped; the name becomes the record key', () => {
    const servers = toSdkMcpServers([
      stdio('a', 'alpha', true, { args: ['-y', 'pkg'], env: { ROOT: '/x' } }),
      stdio('b', 'bravo', false),
      stdio('c', 'charlie', true),
    ]);
    expect(servers).toBeDefined();
    expect(Object.keys(servers ?? {}).sort()).toEqual(['alpha', 'charlie']);
  });

  test('stdio OMITS `type` and only sets env when non-empty', () => {
    const servers = toSdkMcpServers([
      stdio('a', 'with-env', true, { args: ['-y', 'pkg'], env: { K: 'v' } }),
      stdio('b', 'no-env', true),
    ]);
    const withEnv = servers?.['with-env'];
    const noEnv = servers?.['no-env'];
    // stdio config has no `type` key (the SDK defaults `type?: 'stdio'`).
    expect(withEnv).toEqual({ command: 'npx', args: ['-y', 'pkg'], env: { K: 'v' } });
    expect(withEnv && 'type' in withEnv).toBe(false);
    // An empty env map is omitted entirely.
    expect(noEnv).toEqual({ command: 'npx', args: [] });
    expect(noEnv && 'env' in noEnv).toBe(false);
  });

  test('http SETS type=http and only sets headers when non-empty', () => {
    const servers = toSdkMcpServers([
      {
        id: 'h1',
        name: 'github',
        enabled: true,
        config: {
          transport: 'http',
          url: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer t' },
        },
      },
      {
        id: 'h2',
        name: 'plain',
        enabled: true,
        config: { transport: 'http', url: 'https://example.com/x', headers: {} },
      },
    ]);
    expect(servers?.['github']).toEqual({
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer t' },
    });
    const plain = servers?.['plain'];
    expect(plain).toEqual({ type: 'http', url: 'https://example.com/x' });
    expect(plain && 'headers' in plain).toBe(false);
  });

  test('sse SETS type=sse', () => {
    const servers = toSdkMcpServers([
      {
        id: 's1',
        name: 'legacy',
        enabled: true,
        config: {
          transport: 'sse',
          url: 'https://example.com/sse',
          headers: { 'X-Key': 'abc' },
        },
      },
    ]);
    expect(servers?.['legacy']).toEqual({
      type: 'sse',
      url: 'https://example.com/sse',
      headers: { 'X-Key': 'abc' },
    });
  });

  test('a later duplicate name wins (last write to the record key)', () => {
    const servers = toSdkMcpServers([
      stdio('a', 'dup', true, { args: ['first'] }),
      stdio('b', 'dup', true, { args: ['second'] }),
    ]);
    expect(Object.keys(servers ?? {})).toEqual(['dup']);
    expect(servers?.['dup']).toEqual({ command: 'npx', args: ['second'] });
  });
});
