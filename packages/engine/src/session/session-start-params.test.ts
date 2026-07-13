/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import type { Config, SurfaceCommand } from '@nightcore/contracts';

import { resolveStartSessionParams } from './session-start-params';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    model: 'claude-opus-4-8',
    permissions: { allow: [], deny: [], mode: 'default' },
    settingSources: ['user', 'project', 'local'],
    todoFeatureEnabled: true,
    maxTurns: 200,
    paths: { home: '/home/nightcore', sessions: '/home/nightcore/sessions' },
    logLevel: 'silent',
    ...overrides,
  };
}

function startCommand(
  overrides: Partial<Extract<SurfaceCommand, { type: 'start-session' }>> = {},
): Extract<SurfaceCommand, { type: 'start-session' }> {
  return { type: 'start-session', prompt: 'hello', ...overrides };
}

describe('resolveStartSessionParams', () => {
  test('resolves model/cwd/maxTurns from config defaults when the command sets none', () => {
    const params = resolveStartSessionParams(
      7,
      startCommand(),
      makeConfig({ model: 'claude-sonnet-5' }),
    );

    expect(params.sessionId).toBe(7);
    expect(params.prompt).toBe('hello');
    expect(params.model).toBe('claude-sonnet-5');
    expect(params.maxTurns).toBe(200);
    expect(typeof params.cwd).toBe('string');
    expect(params.cwd.length).toBeGreaterThan(0);
  });

  test('a per-command model/cwd/maxTurns override wins over the config default', () => {
    const params = resolveStartSessionParams(
      1,
      startCommand({ model: 'claude-haiku-5', cwd: '/proj/worktree', maxTurns: 5 }),
      makeConfig({ model: 'claude-opus-4-8', maxTurns: 200 }),
    );

    expect(params.model).toBe('claude-haiku-5');
    expect(params.cwd).toBe('/proj/worktree');
    expect(params.maxTurns).toBe(5);
  });

  test('maxBudgetUsd is omitted by default (uncapped) and applies the configured default when set', () => {
    const uncapped = resolveStartSessionParams(1, startCommand(), makeConfig());
    expect(uncapped.maxBudgetUsd).toBeUndefined();

    const capped = resolveStartSessionParams(
      1,
      startCommand(),
      makeConfig({ maxBudgetUsd: 10 }),
    );
    expect(capped.maxBudgetUsd).toBe(10);

    const overridden = resolveStartSessionParams(
      1,
      startCommand({ maxBudgetUsd: 2.5 }),
      makeConfig({ maxBudgetUsd: 10 }),
    );
    expect(overridden.maxBudgetUsd).toBe(2.5);
  });

  test('optional command fields are forwarded only when present', () => {
    const bare = resolveStartSessionParams(1, startCommand(), makeConfig());
    expect(bare.effort).toBeUndefined();
    expect(bare.autonomyOverride).toBeUndefined();
    expect(bare.kind).toBeUndefined();
    expect(bare.resumeSessionId).toBeUndefined();
    expect(bare.mcpServers).toBeUndefined();
    expect(bare.appendContextPack).toBeUndefined();
    expect(bare.harnessPolicy).toBeUndefined();
    expect(bare.ledgerPath).toBeUndefined();
    expect(bare.sandboxWrites).toBeUndefined();
    expect(bare.images).toBeUndefined();

    const full = resolveStartSessionParams(
      1,
      startCommand({
        autonomy: 'ask',
        kind: 'build',
        resumeSessionId: 'sdk-uuid-prior',
        appendContextPack: 'pack text',
        ledgerPath: '/proj/.nightcore/ledger/task-1.ndjson',
        sandboxWrites: true,
        images: [{ format: 'png', data: 'YmFzZTY0' }],
      }),
      makeConfig({ effort: 'high' }),
    );
    expect(full.effort).toBe('high');
    expect(full.autonomyOverride).toBe('ask');
    expect(full.kind).toBe('build');
    expect(full.resumeSessionId).toBe('sdk-uuid-prior');
    expect(full.appendContextPack).toBe('pack text');
    expect(full.ledgerPath).toBe('/proj/.nightcore/ledger/task-1.ndjson');
    expect(full.sandboxWrites).toBe(true);
    expect(full.images).toEqual([{ format: 'png', data: 'YmFzZTY0' }]);
  });

  test('a per-command effort override wins over the config default', () => {
    const params = resolveStartSessionParams(
      1,
      startCommand({ effort: 'low' }),
      makeConfig({ effort: 'high' }),
    );
    expect(params.effort).toBe('low');
  });
});
