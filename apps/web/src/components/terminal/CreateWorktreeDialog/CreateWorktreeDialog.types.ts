/** Props + payload for the "Create new worktree" dialog (spec PR 5a). */
import type { BranchInfo } from '@/lib/bridge';

/** The confirmed create request — the name (slugged server-side, never trusted), whether
 *  to create a `term/<slug>` branch or check out `base` detached, and the base ref. */
export interface CreateWorktreeRequest {
  /** The display name the user typed; the server sanitizes it into a slug. */
  name: string;
  /** Create a new `term/<slug>` branch off `base` (true) or a detached scratch worktree
   *  at `base` (false). */
  createBranch: boolean;
  /** The base branch to branch off / check out (empty ⇒ the project's base branch). */
  base: string;
}

/** Props for the {@link CreateWorktreeDialog} — a presentational modal. The parent owns
 *  the branch list, the busy/error state, and the create call; the dialog just collects
 *  the name / branch toggle / base and emits {@link CreateWorktreeRequest} on confirm. */
export interface CreateWorktreeDialogProps {
  /** Whether the dialog is mounted/visible. */
  open: boolean;
  /** The project's branches for the base picker (from `listBranches`). */
  branches: BranchInfo[];
  /** A create is in flight — disables the form + shows a spinner. */
  busy?: boolean;
  /** A create error to surface inline WITHOUT closing (bad name, git failure). */
  error?: string | null;
  /** Fired with the collected request on confirm. */
  onConfirm: (request: CreateWorktreeRequest) => void;
  /** Fired on Esc, click-outside, or Cancel. */
  onClose: () => void;
}
