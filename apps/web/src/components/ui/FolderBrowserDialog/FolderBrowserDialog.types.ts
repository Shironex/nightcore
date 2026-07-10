/** Props + row shape for the {@link FolderBrowserDialog} — a shared folder-picker
 *  dialog (ported from AutoMaker's file browser) that walks the filesystem one
 *  level at a time and returns a chosen directory. */
import type { DirectoryEntry } from '@/lib/bridge';

/** The default localStorage key for the recent-folders list. Consumers can pass
 *  their own `recentsKey` so, e.g., the terminal picker keeps its own recents. */
export const DEFAULT_RECENTS_KEY = 'nc:folder-browser:recents';

/** How many recent folders to remember. */
export const MAX_RECENT_FOLDERS = 8;

export interface FolderBrowserDialogProps {
  /** Whether the dialog is mounted/visible. */
  open: boolean;
  /** Fired on Esc, click-outside, or Cancel. */
  onClose: () => void;
  /** Fired with the chosen directory's absolute (canonical) path. The dialog closes
   *  itself after calling this. */
  onSelect: (path: string) => void;
  /** Dialog heading. */
  title?: string;
  /** Sub-heading under the title. */
  description?: string;
  /** Where to open initially; falls back to the user's home directory when unset or
   *  when the path can't be listed. */
  initialPath?: string | null;
  /** localStorage key for this consumer's recent-folders list. */
  recentsKey?: string;
  /** The confirm button's label (e.g. "Open terminal here"). */
  selectLabel?: string;
}

/** One breadcrumb segment: the display label and the (display) path to navigate to
 *  when it is clicked. The server re-canonicalizes the path on the next listing, so
 *  a Windows verbatim-stripped path navigates correctly. */
export interface Breadcrumb {
  label: string;
  path: string;
}

/** What {@link useFolderBrowser} hands the presentational dialog. */
export interface FolderBrowserState {
  /** The canonical path currently listed (empty before the first listing). */
  currentPath: string;
  /** The breadcrumb segments for `currentPath` (display labels + nav targets). */
  breadcrumbs: Breadcrumb[];
  /** The parent directory's path, or null at a filesystem root (drives the up button). */
  parentPath: string | null;
  /** The current listing's child directories, filtered by the search query. */
  entries: DirectoryEntry[];
  /** True while a listing request is in flight. */
  loading: boolean;
  /** A listing error (permission denied, vanished dir, …) shown inline, else null. */
  error: string | null;
  /** The search/filter query over the current listing. */
  query: string;
  /** Whether hidden (dot-prefixed) directories are shown. */
  showHidden: boolean;
  /** The recent folders (most-recent first), for the quick-jump chips. */
  recents: string[];
  setQuery: (query: string) => void;
  toggleHidden: (show: boolean) => void;
  /** Navigate into (list) a directory by path; null lands on home. */
  navigate: (path: string | null) => void;
  /** Choose a directory as the result (adds to recents, fires onSelect, closes). */
  choose: (path: string) => void;
  /** Single-click a folder row → descend into it (double-click chooses it). */
  onRowClick: (entry: DirectoryEntry) => void;
  /** Double-click a folder row → choose it. */
  onRowDoubleClick: (entry: DirectoryEntry) => void;
  /** Remove a path from the recent-folders list. */
  removeRecent: (path: string) => void;
}
