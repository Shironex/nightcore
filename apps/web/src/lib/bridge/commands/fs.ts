/** Bridge commands — read-only filesystem browsing for the terminal folder picker.
 *
 *  `list_directory` walks the filesystem one level at a time (directories only) so
 *  the FolderBrowserDialog can let a user open a terminal in ANY directory (ported
 *  from AutoMaker's file browser). `directory_exists` is the fail-closed probe
 *  behind the terminal restore action ("start a fresh shell here").
 *
 *  Both degrade to a synthetic in-memory filesystem (`../mocks`) outside the Tauri
 *  webview, so Storybook / component tests / `dogfood:ui` render a fully navigable
 *  browser without a real backend. */
import { isTauri, tauriInvoke } from '../internal';
import { echoDirectoryExists, echoListDirectory } from '../mocks';
import type { DirectoryListing } from '../types';

/** List the child directories of `path`, one level deep. `path === null` lands on
 *  the user's home directory (the picker's default). `includeHidden` surfaces
 *  dot-prefixed directories (off by default). Directories only; sorted
 *  case-insensitively; each entry flagged `isGitRepo`. Rejects (e.g. a vanished or
 *  unreadable dir) surface to the caller as the dialog's inline error. */
export async function listDirectory(
  path: string | null,
  includeHidden = false,
): Promise<DirectoryListing> {
  if (!isTauri()) return echoListDirectory(path, includeHidden);
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<DirectoryListing>('list_directory', { path, includeHidden });
}

/** Whether `path` still resolves to an existing directory — the fail-closed probe
 *  for the restore "start a fresh shell here" gate. Returns `false` (never throws)
 *  for a missing / non-directory path, so a vanished cwd disables the action.
 *  Outside Tauri it answers from the synthetic mock filesystem. */
export async function directoryExists(path: string): Promise<boolean> {
  if (!isTauri()) return echoDirectoryExists(path);
  return tauriInvoke<boolean>('directory_exists', { path }, false);
}
