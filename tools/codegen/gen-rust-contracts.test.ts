/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { def, numberRustType } from './gen-rust-contracts.ts';

/**
 * Canary for the load-bearing numeric mapping in the zod → Rust contract emitter
 * (`numberRustType`). JSON has no int/float distinction, so a silent `u64 → f64`
 * regression deserializes the same fixture bytes fine and slips past the Rust
 * round-trip conformance test in `contracts/mod.rs`. These assertions pin the
 * mapping to zod's internal check AST so a dependency bump that reshapes it fails
 * HERE, loudly, instead of silently downgrading every bounded integer to f64.
 */
describe('numberRustType maps zod number shapes to Rust numerics', () => {
  const cases: Array<[string, z.ZodType, string]> = [
    // Safe-int with a non-negative lower bound → unsigned.
    ['z.number().int().positive()', z.number().int().positive(), 'u64'],
    ['z.number().int().nonnegative()', z.number().int().nonnegative(), 'u64'],
    ['z.number().int().min(0)', z.number().int().min(0), 'u64'],
    // Safe-int without a non-negative bound → signed.
    ['z.number().int()', z.number().int(), 'i64'],
    // No integer format → floating point (costUsd, confidence, timestamps).
    ['z.number()', z.number(), 'f64'],
    ['z.number().nonnegative() (no .int())', z.number().nonnegative(), 'f64'],
    ['z.number().positive() (no .int())', z.number().positive(), 'f64'],
  ];
  for (const [label, schema, expected] of cases) {
    test(`${label} → ${expected}`, () => {
      expect(numberRustType(def(schema), label)).toBe(expected);
    });
  }
});

describe('numberRustType fails loud on an unrecognized check shape', () => {
  test('throws when a check kind is not recognized (drift signal)', () => {
    // Simulates zod renaming/reshaping its internal check AST: a check whose
    // `check` field the emitter does not know must NOT silently fall through to
    // f64 — it must throw so the drift is caught at codegen time.
    const drifted = { checks: [{ check: 'int_format_v5', format: 'safeint' }] };
    expect(() => numberRustType(drifted, 'drift.field')).toThrow(
      /unrecognized z\.number\(\) check/,
    );
  });

  test('throws when a check entry is missing its `check` field', () => {
    const malformed = { checks: [{ format: 'safeint' }] };
    expect(() => numberRustType(malformed, 'malformed.field')).toThrow(
      /unrecognized z\.number\(\) check/,
    );
  });

  test('does NOT throw on an absent check set (genuine plain number → f64)', () => {
    // An ABSENT check set is a real `z.number()`, not drift — it must map to f64,
    // never throw. This is the boundary the finding's literal suggested fix got
    // wrong (throwing on `checks.length === 0` would break every f64 field).
    expect(numberRustType({ checks: [] }, 'plain.field')).toBe('f64');
    expect(numberRustType({}, 'plain.field')).toBe('f64');
  });
});
