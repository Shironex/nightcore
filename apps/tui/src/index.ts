#!/usr/bin/env bun
/**
 * Nightcore TUI — STUB for the foundation.
 *
 * The full terminal UI (OpenTUI/Ink + React, plan-vs-build toggle, streamed
 * render, interactive permission approval) is deferred. This stub exists to lock
 * the dependency boundary: the TUI imports the engine FAÇADE + contracts only,
 * never the SDK directly. See docs/architecture.md for the build-out plan.
 */
import { SessionManager } from '@nightcore/engine';
import type { Config } from '@nightcore/contracts';

// Type-only reference proving the façade boundary compiles. The real TUI will
// construct a SessionManager and render its event stream.
export type TuiEngine = SessionManager;
export type TuiConfig = Config;

function main(): void {
  process.stdout.write('Nightcore TUI — coming soon.\n');
  process.stdout.write('Use the headless CLI for now: `bun run apps/cli/src/index.ts "<prompt>"`\n');
}

main();
