#!/usr/bin/env bun
/**
 * Cross-platform Rust CI gate — mirrors `.github/workflows/ci.yml` rust-checks:
 *   cargo fmt --check → test:rust → clippy → ts-rs drift diff.
 *
 * On Windows, `cargo fmt --check` fails when core.autocrlf rewrites the
 * working tree to CRLF while rustfmt.toml pins `newline_style = "Unix"`. CI
 * runs on Linux with LF checkouts, so fmt is skipped locally on win32; the
 * remaining steps still run here.
 */
import { execSync } from 'node:child_process';
import { platform } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '..');
const MANIFEST = 'apps/desktop/src-tauri/Cargo.toml';

function run(cmd: string): void {
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

if (platform() !== 'win32') {
  run(`cargo fmt --check --manifest-path ${MANIFEST}`);
  run(
    `cargo clippy --all-targets --manifest-path ${MANIFEST} -- -D warnings -W clippy::await_holding_lock -W clippy::unwrap_used`,
  );
  run('bun run test:rust');
} else {
  process.stderr.write(
    'check-rust: skipping cargo fmt --check and clippy on Windows (CRLF checkout + cfg-gated test imports differ from Linux CI); CI enforces both on ubuntu-latest\n',
  );
  // Single-threaded: parallel git-worktree integration tests flake on win32
  // when invoked from Husky while the parent repo is mid-commit.
  run('bun run --filter @nightcore/sidecar compile');
  run(`cargo test --manifest-path ${MANIFEST} -- --test-threads=1`);
}

run('git diff --exit-code -- apps/web/src/lib/generated');
