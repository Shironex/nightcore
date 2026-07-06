/**
 * The shared path-resolution core for the workspace-confinement gate — the lexical
 * (never `realpath`) primitives the workspace / sensitive-read / MCP rule families
 * all resolve against. Extracted from `workspace-confinement.ts` so the three
 * families share ONE resolution + containment semantics; the orchestrator and its
 * documentation stay in that facade. Lexical by design (a `Write` target need not
 * exist yet); the limits are documented at the facade head.
 */
import * as os from 'node:os';
import * as path from 'node:path';

/** The user's home directory, resolved once. Empty when it can't be determined —
 *  the home-relative credential-store checks are then skipped (the filename-pattern
 *  checks, which don't need home, still apply). */
export const HOME_DIR: string = ((): string => {
  try {
    const home = os.homedir();
    return home.length > 0 ? path.resolve(home) : '';
  } catch {
    return '';
  }
})();

/** Lexically resolve `p` against `cwd` (an absolute `p` stands alone). No fs
 *  access, so a not-yet-created `Write` target still resolves. Exported for the
 *  harness-policy gate (same resolution, same limits — lexical, not realpath). */
export function resolveAgainst(cwd: string, p: string): string {
  return path.isAbsolute(p) ? path.resolve(p) : path.resolve(cwd, p);
}

/** True when `child` is `parent` itself or nested beneath it. Both are resolved
 *  absolute; the trailing-separator guard stops `/repo-evil` matching `/repo`.
 *  Exported for the harness-policy gate. */
export function isWithin(child: string, parent: string): boolean {
  const c = path.resolve(child);
  const p = path.resolve(parent);
  return c === p || c.startsWith(p + path.sep);
}

/**
 * The roots a write may legitimately land in: always the run cwd, PLUS the OS
 * temp dir for scratch files — but the temp allowance is DROPPED when the run cwd
 * is itself under the temp dir. Otherwise a checkout hosted under temp (the
 * dogfood scratch repo, or a clone in /tmp) would have its whole tree swallowed by
 * the temp allowance and confinement would silently fail open. Takes the already
 * resolved cwd so callers don't re-resolve.
 */
export function allowedRoots(resolvedCwd: string): readonly string[] {
  const tmp = path.resolve(os.tmpdir());
  return isWithin(resolvedCwd, tmp) ? [resolvedCwd] : [resolvedCwd, tmp];
}

/** True when `resolved` is within any allowed root. */
export function isAllowedTarget(resolved: string, roots: readonly string[]): boolean {
  return roots.some((root) => isWithin(resolved, root));
}

/** Extract the string target held under `key` in a tool's input, or undefined
 *  when absent / not a non-empty string. Exported for the harness-policy gate. */
export function targetUnderKey(toolInput: unknown, key: string): string | undefined {
  if (toolInput === null || typeof toolInput !== 'object') return undefined;
  const value = (toolInput as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** The reason the agent sees on denial — names the working dir AND the offending
 *  target so the model can adapt (retry with a path inside the working dir). */
export function confinementReason(target: string, cwd: string): string {
  return (
    `Blocked by Nightcore worktree isolation: this task's working directory is ${cwd}, ` +
    `but the tool targets ${target}, which is OUTSIDE it. Operate only inside the working ` +
    `directory (relative paths are resolved against it). Writing outside it would corrupt ` +
    `another checkout of the repository.`
  );
}
