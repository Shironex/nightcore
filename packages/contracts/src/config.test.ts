/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import {
  ConfigFileSchema,
  ConfigSchema,
  McpServerEntrySchema,
  McpServerTransportSchema,
  PermissionPolicySchema,
} from './config.js';

describe('PermissionPolicySchema defaults', () => {
  test('fills empty allow/deny lists and a default mode', () => {
    const parsed = PermissionPolicySchema.parse({});
    expect(parsed).toEqual({ allow: [], deny: [], mode: 'default' });
  });

  test('rejects an unknown permission mode', () => {
    const result = PermissionPolicySchema.safeParse({ mode: 'yolo' });
    expect(result.success).toBe(false);
  });
});

describe('ConfigSchema defaults', () => {
  test('fills model, permissions and logLevel when only paths are given', () => {
    const parsed = ConfigSchema.parse({
      paths: { home: '/home/.nightcore', sessions: '/home/.nightcore/sessions' },
    });
    expect(parsed.model).toBe('claude-opus-4-8');
    expect(parsed.logLevel).toBe('info');
    expect(parsed.permissions).toEqual({
      allow: [],
      deny: [],
      mode: 'default',
    });
  });

  test('requires paths', () => {
    const result = ConfigSchema.safeParse({ model: 'x' });
    expect(result.success).toBe(false);
  });
});

describe('ConfigFileSchema', () => {
  test('accepts an empty object and carries NO defaults', () => {
    // The file schema is default-free: an absent key stays absent so layering
    // can inherit it rather than clobber with a defaulted value. Defaults live
    // only on the resolved `ConfigSchema`.
    const parsed = ConfigFileSchema.parse({});
    expect(parsed).toEqual({});
  });

  test('keeps only explicitly-set keys (partial permissions)', () => {
    const parsed = ConfigFileSchema.parse({
      permissions: { mode: 'acceptEdits' },
    });
    expect(parsed).toEqual({ permissions: { mode: 'acceptEdits' } });
    expect(parsed.permissions && 'allow' in parsed.permissions).toBe(false);
  });

  test('omits resolved paths from the user-authored shape', () => {
    const result = ConfigFileSchema.safeParse({
      paths: { home: '/x', sessions: '/y' },
    });
    // `paths` is stripped (not part of ConfigFile); parsing still succeeds.
    expect(result.success).toBe(true);
    if (result.success) {
      expect('paths' in result.data).toBe(false);
    }
  });

  test('rejects an invalid logLevel', () => {
    const result = ConfigFileSchema.safeParse({ logLevel: 'loud' });
    expect(result.success).toBe(false);
  });
});

describe('McpServerTransportSchema', () => {
  test('parses a stdio transport, defaulting args/env', () => {
    const parsed = McpServerTransportSchema.parse({
      transport: 'stdio',
      command: 'npx',
    });
    expect(parsed).toEqual({
      transport: 'stdio',
      command: 'npx',
      args: [],
      env: {},
    });
  });

  test('parses an http transport, defaulting headers', () => {
    const parsed = McpServerTransportSchema.parse({
      transport: 'http',
      url: 'https://example.com/mcp',
    });
    expect(parsed).toEqual({
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: {},
    });
  });

  test('parses an sse transport, defaulting headers', () => {
    const parsed = McpServerTransportSchema.parse({
      transport: 'sse',
      url: 'https://example.com/sse',
    });
    expect(parsed).toEqual({
      transport: 'sse',
      url: 'https://example.com/sse',
      headers: {},
    });
  });

  test('rejects an unknown transport tag', () => {
    const result = McpServerTransportSchema.safeParse({
      transport: 'websocket',
      url: 'ws://x',
    });
    expect(result.success).toBe(false);
  });

  test('rejects a stdio transport missing its command', () => {
    const result = McpServerTransportSchema.safeParse({ transport: 'stdio' });
    expect(result.success).toBe(false);
  });
});

describe('McpServerEntrySchema', () => {
  test('defaults enabled to true and carries the nested transport', () => {
    const parsed = McpServerEntrySchema.parse({
      id: 'srv-1',
      name: 'filesystem',
      config: { transport: 'stdio', command: 'npx', args: ['-y', 'pkg'] },
    });
    expect(parsed).toEqual({
      id: 'srv-1',
      name: 'filesystem',
      enabled: true,
      config: { transport: 'stdio', command: 'npx', args: ['-y', 'pkg'], env: {} },
    });
  });

  test('rejects an entry whose config has a bad transport', () => {
    const result = McpServerEntrySchema.safeParse({
      id: 'srv-1',
      name: 'x',
      config: { transport: 'nope' },
    });
    expect(result.success).toBe(false);
  });
});
