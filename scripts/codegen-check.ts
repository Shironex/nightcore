#!/usr/bin/env bun
/**
 * `codegen:check` — ONE command that verifies every generated / cross-tier contract
 * artifact is in sync (issue #158, T17 contract debt). Today the drift gates are scattered
 * across `lint` (zod→Rust), `test:node` (TS canaries), and `check:rust` (Rust→web ts-rs +
 * parity) — so a contributor who touches a contract has no single "is my codegen coherent?"
 * command. This aggregates them, fast TS-side leg first so the cheap checks fail before the
 * Rust toolchain spins up.
 *
 * The legs, in order:
 *   1. zod → Rust contracts — `gen-rust-contracts.ts --check` regenerates `generated.rs` +
 *      `fixtures.json` in memory and diffs (the same gate lint-meta's `codegen-drift` runs).
 *   2. TS codegen canaries + cross-boundary conformance — the `tools/codegen` unit tests
 *      (ENUM_NAMES injectivity, number-type drift, channel determinism) and
 *      `codegen-conformance.test.ts` (ts-rs ⇄ zod field-set + round-trip).
 *   3. Rust → web ts-rs bindings + contract parity — `cargo test` regenerates the ts-rs
 *      bindings under `apps/web/src/lib/generated` as a side effect and runs the contract
 *      round-trip / variant-parity tests; a `git diff --exit-code` then fails on any
 *      un-committed binding drift. Scoped to the `bindings` + `contracts` tests (NOT full
 *      `check:rust`) so this stays a codegen gate, not a clippy/fmt pass.
 *
 * Any leg failing exits non-zero. Run after changing anything in `packages/contracts`,
 * `tools/codegen`, or a ts-rs-exported Rust type.
 */
import { execSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '..');
const MANIFEST = 'apps/desktop/src-tauri/Cargo.toml';
const GENERATED_WEB = 'apps/web/src/lib/generated';

function step(label: string, cmd: string): void {
  process.stdout.write(`\n▶ codegen:check — ${label}\n`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

// 1. zod → Rust: generated.rs + fixtures.json.
step('zod → Rust contracts drift', 'bun run codegen:contracts --check');

// 2. TS codegen canaries + cross-boundary conformance.
step(
  'TS codegen canaries + conformance',
  'bun test tools/codegen packages/contracts/src/codegen-conformance.test.ts',
);

// 3. Rust → web ts-rs bindings + contract parity. `cargo test` takes a single test-name
//    filter, so the two codegen-relevant groups run as separate scoped passes (the crate is
//    compiled once and cached). The `bindings` pass regenerates the web bindings on disk; the
//    `contracts` pass runs the round-trip / variant-parity guards; the git diff then fails on
//    any binding that was not re-committed. Scoped (NOT full `check:rust`) so this stays a
//    codegen gate, not a clippy/fmt pass.
step(
  'Rust ts-rs binding regen',
  `cargo test --manifest-path ${MANIFEST} --lib bindings`,
);
step(
  'Rust contract parity + round-trip',
  `cargo test --manifest-path ${MANIFEST} --lib contracts`,
);
step(
  'Rust → web ts-rs bindings drift',
  `git diff --exit-code -- ${GENERATED_WEB}`,
);

process.stdout.write('\n✓ codegen:check — all generated artifacts in sync\n');
