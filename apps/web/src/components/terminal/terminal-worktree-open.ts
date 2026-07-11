/**
 * Terminal ⇄ worktree opening orchestration (spec PR 5). Two feature-root hooks split out
 * of `useTerminalView` so that hook stays under the file-size ratchet (the `terminal-*.ts`
 * pattern):
 *
 *  - {@link useCreateWorktree} — the new-tab picker's "Create new worktree…" flow: the
 *    dialog state, the branch list, and the create-then-spawn action (5a).
 *  - {@link useTerminalOpenRequest} — consumes a pending "open terminal here" request set
 *    by the Worktrees view, spawning a shell in that cwd on mount (5b).
 *
 * USER-ONLY seam: both run behind explicit user gestures and spawn into the human's own
 * PTY via the view's `spawnInto`. No agent-reachable path calls into this module.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useToast } from '@/components/ui';
import type { BranchInfo, TerminalSessionInfo } from '@/lib/bridge';
import { listBranches, terminalCreateWorktree } from '@/lib/bridge';
import { consumePendingOpenTerminal } from '@/lib/terminal-links';

import type { CreateWorktreeRequest } from './CreateWorktreeDialog';
import { spawnErrorText } from './terminal-view-helpers';

/** Spawn a live shell in `cwd` — the view's own spawn path, threaded in so both hooks
 *  reuse the tab-append / activate behaviour. */
type SpawnInto = (path: string, confined: boolean) => Promise<TerminalSessionInfo>;

export interface UseCreateWorktreeInput {
  /** The view's spawn path — the new worktree opens a terminal in its dir. */
  readonly spawnInto: SpawnInto;
  /** The confined choice to carry into the spawned shell (the picker's current toggle). */
  readonly confined: boolean;
}

/** The "Create new worktree" dialog state + the create-then-spawn action (spec PR 5a). */
export function useCreateWorktree({ spawnInto, confined }: UseCreateWorktreeInput) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openCreate = useCallback(() => {
    setError(null);
    setOpen(true);
    // Load the base-branch list lazily when the dialog opens (empty outside Tauri).
    void listBranches().then(setBranches, () => setBranches([]));
  }, []);

  const closeCreate = useCallback(() => setOpen(false), []);

  const submit = useCallback(
    async (request: CreateWorktreeRequest) => {
      setError(null);
      setBusy(true);
      try {
        const base = request.base.trim() === '' ? null : request.base;
        const worktree = await terminalCreateWorktree(request.name, request.createBranch, base);
        // Open a shell in the freshly created worktree (5a — "then opens the terminal").
        await spawnInto(worktree.path, confined);
        setOpen(false);
      } catch (err) {
        // Bad name / git failure / session cap — surface inline + toast, keep it open.
        setError(spawnErrorText(err));
        toast.error('Could not create worktree', err);
      } finally {
        setBusy(false);
      }
    },
    [spawnInto, confined, toast],
  );

  return { open, branches, busy, error, openCreate, closeCreate, submit };
}

export interface UseTerminalOpenRequestInput {
  /** Whether the view's initial session load has resolved — gates the consume so the
   *  spawned tab appends after the existing sessions, not during the load gap. */
  readonly loaded: boolean;
  /** The view's spawn path. */
  readonly spawnInto: SpawnInto;
  /** The confined choice for an open-here spawn (the sticky Settings default). */
  readonly confined: boolean;
}

/** Consume a pending "open terminal here" request (spec PR 5b) once the view has loaded,
 *  spawning a shell in the requested cwd. The `done` ref guards against a double-spawn on
 *  re-render; a fresh mount (navigating back to the Terminal view) resets it, so each
 *  routed open-here consumes exactly once. */
export function useTerminalOpenRequest({ loaded, spawnInto, confined }: UseTerminalOpenRequestInput) {
  const toast = useToast();
  const done = useRef(false);

  useEffect(() => {
    if (!loaded || done.current) return;
    done.current = true;
    const cwd = consumePendingOpenTerminal();
    if (cwd === null) return;
    void spawnInto(cwd, confined).catch((err) => {
      toast.error('Could not open terminal here', err);
    });
  }, [loaded, spawnInto, confined, toast]);
}
