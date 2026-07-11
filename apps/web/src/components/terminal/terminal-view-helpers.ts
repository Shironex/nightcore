/**
 * Small pure helpers lifted out of `useTerminalView` to keep that hook under the
 * file-size ratchet (a feature-root module, the `terminal-*.ts` pattern). No React —
 * plain functions the view hook composes.
 */
import type { WorktreeInfo } from '@/lib/bridge';

import type { TerminalTarget } from './NewTabPicker';
import { displayPath } from './terminal-shared';

/** A Rust command rejection arrives as a string; normalize any thrown value to a
 *  user-facing line for a picker/dialog inline error. */
export function spawnErrorText(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  return 'Could not open the terminal.';
}

/** Build the picker's target list: the repo root first, then each live worktree. */
export function buildTargets(
  projectPath: string | null,
  projectName: string | null,
  worktrees: readonly WorktreeInfo[],
): TerminalTarget[] {
  const targets: TerminalTarget[] = [];
  if (projectPath !== null) {
    targets.push({
      kind: 'repo',
      label: projectName ?? 'Repo root',
      // `path` stays canonical — it is the spawn cwd (re-canonicalized server-side)
      // and the fresh-shell restore-membership key. Only `detail` is prettified for
      // display, so a Windows verbatim path (`\\?\X:\dev\nightcore`) shows cleanly.
      path: projectPath,
      detail: displayPath(projectPath),
    });
  }
  for (const wt of worktrees) {
    targets.push({ kind: 'worktree', label: wt.branch, path: wt.path });
  }
  return targets;
}
