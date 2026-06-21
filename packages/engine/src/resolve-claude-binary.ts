import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';

/**
 * Resolve a path to the `claude` executable to hand the SDK via
 * `Options.pathToClaudeCodeExecutable`.
 *
 * The SDK normally resolves its bundled `claude` binary from `node_modules` at
 * runtime, which works in-repo but breaks a `bun build --compile` distributable
 * (there's no `node_modules` next to the compiled binary). We only override the
 * path when we can name one explicitly:
 *
 *   1. `NIGHTCORE_CLAUDE_PATH` if set and it exists on disk;
 *   2. else whatever `which claude` resolves to on PATH;
 *   3. else `undefined` — leaving the SDK's in-repo default in place.
 *
 * Returning `undefined` is the common in-repo case, so the normal dev path is
 * untouched. All probing failures are swallowed (degrade-not-throw).
 */
export function resolveClaudeBinary(): string | undefined {
  const fromEnv = process.env.NIGHTCORE_CLAUDE_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  try {
    const found = execFileSync('which', ['claude'], {
      encoding: 'utf8',
    }).trim();
    if (found && fs.existsSync(found)) return found;
  } catch {
    // `which` missing / non-zero exit (not on PATH) — fall through to undefined.
  }

  return undefined;
}
