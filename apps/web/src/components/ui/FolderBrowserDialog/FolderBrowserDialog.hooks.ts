/** The navigation state machine behind {@link FolderBrowserDialog}: one-level
 *  directory listing over the read-only `list_directory` bridge command, a search
 *  filter, breadcrumb derivation, a localStorage-backed recent-folders list, and a
 *  click/double-click discriminator (single click descends, double click chooses).
 *  All state + storage + timers live here (the dialog body stays presentational). */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { type DirectoryEntry, listDirectory } from '@/lib/bridge';
import { displayPath } from '@/lib/path-display';

import {
  type Breadcrumb,
  type FolderBrowserState,
  MAX_RECENT_FOLDERS,
} from './FolderBrowserDialog.types';

/** How long (ms) a single click waits before descending, so a double click can
 *  cancel it and choose the folder instead. */
const DOUBLE_CLICK_WINDOW = 220;

/** Normalize a thrown/rejected value into a user-facing line. */
function errorText(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  return 'Could not read that folder.';
}

/** Read the persisted recent-folders list (most-recent first), tolerant of a
 *  missing/corrupt/blocked store. */
function readRecents(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === 'string').slice(0, MAX_RECENT_FOLDERS);
  } catch {
    return [];
  }
}

/** Persist the recent-folders list (best-effort; private-mode failures are ignored). */
function writeRecents(key: string, recents: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(recents.slice(0, MAX_RECENT_FOLDERS)));
  } catch {
    /* storage disabled — recents just won't persist. */
  }
}

/** Build the breadcrumb trail for a canonical path (display-only; the server
 *  re-canonicalizes each target on navigation, so a verbatim-stripped Windows path
 *  navigates correctly). POSIX gets a leading root ("/") crumb; Windows starts at
 *  the drive. */
export function buildBreadcrumbs(currentPath: string): Breadcrumb[] {
  if (currentPath === '') return [];
  const pretty = displayPath(currentPath);
  const isWindows = pretty.includes('\\');
  const sep = isWindows ? '\\' : '/';
  const segments = pretty.split(/[/\\]+/).filter((s) => s.length > 0);
  const crumbs: Breadcrumb[] = [];
  if (!isWindows) crumbs.push({ label: '/', path: '/' });
  let acc = '';
  segments.forEach((segment, i) => {
    if (i === 0) {
      acc = isWindows ? `${segment}${sep}` : `/${segment}`;
    } else {
      acc = `${acc}${acc.endsWith(sep) ? '' : sep}${segment}`;
    }
    crumbs.push({ label: segment, path: acc });
  });
  return crumbs;
}

interface UseFolderBrowserInput {
  open: boolean;
  initialPath?: string | null;
  recentsKey: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export function useFolderBrowser(input: UseFolderBrowserInput): FolderBrowserState {
  const { open, initialPath, recentsKey, onSelect, onClose } = input;
  const [currentPath, setCurrentPath] = useState('');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [rawEntries, setRawEntries] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const clickTimer = useRef<number | null>(null);

  const cancelPendingClick = useCallback(() => {
    if (clickTimer.current !== null) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
  }, []);

  /** Core listing: fetch one level and reflect it (loading/error/entries). A stale
   *  response from a superseded navigation is ignored via the request token. */
  const requestSeq = useRef(0);
  const list = useCallback(async (path: string | null, hidden: boolean) => {
    const token = (requestSeq.current += 1);
    setLoading(true);
    setError(null);
    try {
      const listing = await listDirectory(path, hidden);
      if (requestSeq.current !== token) return; // a newer navigation won
      setCurrentPath(listing.currentPath);
      setParentPath(listing.parentPath);
      setRawEntries(listing.entries);
    } catch (err) {
      if (requestSeq.current !== token) return;
      setError(errorText(err));
    } finally {
      if (requestSeq.current === token) setLoading(false);
    }
  }, []);

  /** Navigate into a directory (descend / breadcrumb / recent / home): clears the
   *  filter so each folder starts fresh. `null` lands on home. */
  const navigate = useCallback(
    (path: string | null) => {
      cancelPendingClick();
      setQuery('');
      void list(path, showHidden);
    },
    [cancelPendingClick, list, showHidden],
  );

  const toggleHidden = useCallback(
    (show: boolean) => {
      setShowHidden(show);
      void list(currentPath === '' ? (initialPath ?? null) : currentPath, show);
    },
    [list, currentPath, initialPath],
  );

  // Load the initial listing + recents each time the dialog opens; reset the
  // transient view state on close so the next open starts clean. `list` and
  // `cancelPendingClick` are stable (empty-dep callbacks), so this re-runs only on
  // open toggle / initial-target change.
  useEffect(() => {
    if (!open) {
      cancelPendingClick();
      setQuery('');
      setError(null);
      return;
    }
    setRecents(readRecents(recentsKey));
    setShowHidden(false);
    void list(initialPath ?? null, false);
  }, [open, initialPath, recentsKey, list, cancelPendingClick]);

  // Tear the pending-click timer down on unmount.
  useEffect(() => cancelPendingClick, [cancelPendingClick]);

  const choose = useCallback(
    (path: string) => {
      cancelPendingClick();
      const next = [path, ...recents.filter((p) => p !== path)].slice(0, MAX_RECENT_FOLDERS);
      setRecents(next);
      writeRecents(recentsKey, next);
      onSelect(path);
      onClose();
    },
    [cancelPendingClick, recents, recentsKey, onSelect, onClose],
  );

  // Cmd/Ctrl+Enter chooses the current folder (parity with AutoMaker's accelerator).
  // Bare Enter never confirms — the house dialog rule — so this is modifier-gated.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && currentPath !== '' && !loading) {
        e.preventDefault();
        choose(currentPath);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, currentPath, loading, choose]);

  const onRowClick = useCallback(
    (entry: DirectoryEntry) => {
      // Defer the descend so a double-click can cancel it and choose instead.
      cancelPendingClick();
      clickTimer.current = window.setTimeout(() => {
        clickTimer.current = null;
        navigate(entry.path);
      }, DOUBLE_CLICK_WINDOW);
    },
    [cancelPendingClick, navigate],
  );

  const onRowDoubleClick = useCallback(
    (entry: DirectoryEntry) => {
      cancelPendingClick();
      choose(entry.path);
    },
    [cancelPendingClick, choose],
  );

  const removeRecent = useCallback(
    (path: string) => {
      setRecents((prev) => {
        const next = prev.filter((p) => p !== path);
        writeRecents(recentsKey, next);
        return next;
      });
    },
    [recentsKey],
  );

  const breadcrumbs = useMemo(() => buildBreadcrumbs(currentPath), [currentPath]);

  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return rawEntries;
    return rawEntries.filter((e) => e.name.toLowerCase().includes(q));
  }, [rawEntries, query]);

  return {
    currentPath,
    breadcrumbs,
    parentPath,
    entries,
    loading,
    error,
    query,
    showHidden,
    recents,
    setQuery,
    toggleHidden,
    navigate,
    choose,
    onRowClick,
    onRowDoubleClick,
    removeRecent,
  };
}
