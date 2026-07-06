/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import type { z } from 'zod';

import { SessionInfoSchema } from './events.js';
import { FindingLocationSchema } from './insight.js';
import { ProviderConfigSnapshotSchema } from './provider-config.js';

/**
 * Cross-codegen CONFORMANCE tests for the shapes that cross BOTH codegen
 * directions: the zod contract (wire) and a hand-mirrored Rust struct exported
 * back to TS via ts-rs (`apps/web/src/lib/generated/*.ts`).
 *
 * Each direction is already individually guarded (zod→Rust `--check` + fixtures;
 * Rust→ts-rs diff guard). What was missing is a check that the two shapes AGREE
 * on their shared field set — a rename/drop on the zod side that the ts-rs mirror
 * doesn't mirror (or vice-versa) previously slipped through, since the discipline
 * was only a "names are LOAD-BEARING" comment.
 *
 * How this catches drift:
 *  - `zodFieldNames(schema)` reads the LIVE zod object shape, so any field
 *    renamed/dropped/added in the contract changes it automatically.
 *  - `TSRS_FIELDS` is the hand-maintained mirror of the ts-rs generated type's
 *    field names (the file each block cites). The ts-rs side has its own diff
 *    guard (`cargo test`); when that guard flags a Rust-side change, whoever
 *    regenerates updates `TSRS_FIELDS` here — this test then re-pins agreement.
 *  - `RUST_ONLY` lists fields the Rust struct adds on top of the wire contract by
 *    design (e.g. `SessionInfo.orphaned`, computed core-side). They are excluded
 *    from the shared set rather than silently tolerated.
 *
 * A removed/renamed field in either shape fails the field-set assertion; a value
 * that no longer parses fails the round-trip assertion.
 */

/** The field names of a zod object schema, read from its live shape. */
function zodFieldNames(schema: z.ZodObject<z.ZodRawShape>): string[] {
  return Object.keys(schema.shape).sort();
}

/** Assert the zod schema's field set equals the ts-rs mirror minus Rust-only
 *  additions. */
function expectSharedFieldConformance(
  schema: z.ZodObject<z.ZodRawShape>,
  tsrsFields: readonly string[],
  rustOnly: readonly string[] = [],
): void {
  const expectedShared = tsrsFields
    .filter((f) => !rustOnly.includes(f))
    .sort();
  expect(zodFieldNames(schema)).toEqual(expectedShared);
}

describe('SessionInfo double-crossing conformance', () => {
  // Mirror of apps/web/src/lib/generated/SessionInfo.ts (ts-rs export of the Rust
  // `SessionInfo` struct). Note: ts-rs represents Rust `Option<T>` as `T | null`;
  // on the wire the serde `skip_serializing_if = "Option::is_none"` omits None, so
  // the zod schema uses `.optional()` (undefined), never `null`.
  const TSRS_FIELDS = [
    'sdkSessionId',
    'summary',
    'lastModified',
    'fileSize',
    'customTitle',
    'firstPrompt',
    'gitBranch',
    'cwd',
    'tag',
    'createdAt',
    'orphaned',
  ] as const;
  // Rust-computed, not on the wire contract: the core decides orphaned-ness (the
  // web can't `stat` the filesystem).
  const RUST_ONLY = ['orphaned'] as const;

  test('shared field set matches the ts-rs mirror', () => {
    expectSharedFieldConformance(SessionInfoSchema, TSRS_FIELDS, RUST_ONLY);
  });

  test('a full ts-rs-shaped sample round-trips through the zod schema', () => {
    const sample = {
      sdkSessionId: 'sess-uuid',
      summary: 'Fix the flaky test',
      lastModified: 1_700_000_000_000,
      fileSize: 4096,
      customTitle: 'Flake hunt',
      firstPrompt: 'why is this test flaky?',
      gitBranch: 'nc/abc',
      cwd: '/repo/.nightcore/wt/abc',
      tag: 'infra',
      createdAt: 1_699_000_000_000,
    };
    const parsed = SessionInfoSchema.parse(sample);
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(sample).sort());
  });

  test('a minimal sample (required fields only) round-trips', () => {
    const parsed = SessionInfoSchema.parse({
      sdkSessionId: 'sess-uuid',
      summary: 's',
      lastModified: 1,
    });
    expect(parsed.sdkSessionId).toBe('sess-uuid');
  });
});

describe('ProviderConfigSnapshot double-crossing conformance', () => {
  // Mirror of apps/web/src/lib/generated/ProviderConfigSnapshot.ts. The nested
  // section fields (`mcp`/`skills`/`subagents`) are the `ProviderConfigSection`
  // ref ts-rs-side; the zod schema inlines the same object. `extrasStatus` is a
  // zod enum widened to `string` on the ts-rs side — a value-type difference, not
  // a field-name one, so the shared-field check is unaffected.
  const TSRS_FIELDS = [
    'providerId',
    'providerLabel',
    'projectPath',
    'mcp',
    'skills',
    'subagents',
    'model',
    'permissionMode',
    'outputStyle',
    'extrasStatus',
  ] as const;

  test('shared field set matches the ts-rs mirror', () => {
    expectSharedFieldConformance(ProviderConfigSnapshotSchema, TSRS_FIELDS);
  });

  test('a full ts-rs-shaped sample round-trips through the zod schema', () => {
    const section = { status: 'supported' as const };
    const sample = {
      providerId: 'claude',
      providerLabel: 'Claude',
      projectPath: '/repo',
      mcp: section,
      skills: section,
      subagents: section,
      model: 'claude-opus-4-8',
      permissionMode: 'default',
      outputStyle: 'concise',
      extrasStatus: 'supported' as const,
    };
    const parsed = ProviderConfigSnapshotSchema.parse(sample);
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(sample).sort());
  });
});

describe('FindingLocation double-crossing conformance', () => {
  // Mirror of apps/web/src/lib/generated/FindingLocation.ts (Rust-owned, ts-rs
  // export). All optional lines are `number | null` ts-rs-side; the zod schema
  // uses positive-int `.optional()`.
  const TSRS_FIELDS = ['file', 'startLine', 'endLine', 'symbol'] as const;

  test('shared field set matches the ts-rs mirror', () => {
    expectSharedFieldConformance(FindingLocationSchema, TSRS_FIELDS);
  });

  test('a full ts-rs-shaped sample round-trips through the zod schema', () => {
    const sample = {
      file: 'packages/engine/src/index.ts',
      startLine: 10,
      endLine: 42,
      symbol: 'runTailSession',
    };
    const parsed = FindingLocationSchema.parse(sample);
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(sample).sort());
  });

  test('a minimal sample (file only) round-trips', () => {
    const parsed = FindingLocationSchema.parse({ file: 'a.ts' });
    expect(parsed.file).toBe('a.ts');
  });
});
