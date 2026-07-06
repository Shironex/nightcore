/** Bridge commands — pull requests (create / status / push / finalize / comments). */
import { invoke } from '@tauri-apps/api/core';

import { tauriInvoke } from '../internal';
import type {
  PrCommentTriage,
  PrDraft,
  PrReviewComments,
  PrStatus,
  PrSupport,
} from '../types';

// --- Pull requests ----------------------------------------------------------

/** Options for {@link createPrTask}. `base` omitted ⇒ the backend resolves the
 *  task's base branch exactly like merge does. */
export interface CreatePrOptions {
  base?: string;
  title: string;
  body: string;
  draft: boolean;
}

/** Probe PR support for a task's project: `gh` on PATH + an `origin` remote.
 *  Booleans only — the raw remote URL may embed credentials and never crosses
 *  the IPC boundary. Returns a red probe outside Tauri (browser preview) so the
 *  button hides. */
export async function prSupport(id: string): Promise<PrSupport> {
  return tauriInvoke<PrSupport>('pr_support', { id }, { ghInstalled: false, hasRemote: false });
}

/** Draft a PR title/body for a task via a one-shot `claude -p` pass. The command
 *  itself degrades to a deterministic fallback (task title + description), so a
 *  resolved value is always usable; outside Tauri an empty draft is returned and
 *  the dialog falls back locally. `base` re-drafts against a picker-chosen base
 *  (the draft describes `diff <base>...HEAD`); omitted ⇒ the backend default. */
export async function draftPrMessage(id: string, base?: string): Promise<PrDraft> {
  return tauriInvoke<PrDraft>(
    'draft_pr_message',
    { id, base: base ?? null },
    { title: '', body: '' },
  );
}

/** Push a task's worktree branch to `origin` and open a pull request against
 *  `base` via the user's `gh` CLI. The backend re-runs the merge-grade gauntlet
 *  first; on success it persists `prUrl`/`prNumber` and emits the task echo.
 *  Rejects loudly (no silent fallback) so the dialog can surface the failure. */
export async function createPrTask(id: string, opts: CreatePrOptions): Promise<void> {
  const { base, title, body, draft } = opts;
  await invoke('create_pr_task', { id, base: base ?? null, title, body, draft });
}

/** Open an `https://` URL in the system browser (backend-validated https-only).
 *  Used by the PR chip; rejects on a non-https URL. */
export async function openExternal(url: string): Promise<void> {
  await invoke('open_external', { url });
}

/** Fetch the live PR status for a task (requires `prNumber` set) via a bounded
 *  `gh pr view`. On-demand only — the card fetches on mount + manual refresh;
 *  there is deliberately NO polling. Read-only (no lease). Resolves `null`
 *  outside Tauri (browser preview) so the card shows its unavailable note
 *  instead of a fabricated status. */
export async function prStatus(id: string): Promise<PrStatus | null> {
  return tauriInvoke<PrStatus | null>('pr_status', { id }, null);
}

/** Fetch the live status of an arbitrary PR by NUMBER (no task linkage — the
 *  per-PR workspace surface). Mirrors {@link prStatus}: a bounded `gh pr view`,
 *  on-demand only (fetch on mount + manual refresh; NO polling), read-only (no
 *  lease). Resolves `null` outside Tauri (browser preview) so the surface shows
 *  its unavailable note instead of a fabricated status. */
export async function prStatusByNumber(number: number): Promise<PrStatus | null> {
  return tauriInvoke<PrStatus | null>('pr_status_by_number', { number }, null);
}

/** The GitHub login the user's `gh` CLI is authenticated as, for "your PRs"
 *  filtering in the PR workspace. Read-only, on-demand. Resolves `null` outside
 *  Tauri (browser preview) — the surface skips viewer-scoped affordances. */
export async function viewerLogin(): Promise<string | null> {
  return tauriInvoke<string | null>('viewer_login', {}, null);
}

/** Re-push the task branch to its remote (plain push — never `--force`) so an
 *  open PR picks up new local commits. Void: the caller refetches `prStatus`
 *  afterwards. Rejects loudly (and outside Tauri) — no silent fallback. */
export async function pushPrUpdates(id: string): Promise<void> {
  await invoke('push_pr_updates', { id });
}

/** Finalize a REMOTE-merged PR: the backend re-verifies `state == MERGED`
 *  itself, marks the task merged locally, and honors the `cleanupWorktrees`
 *  setting. The updated task arrives via the `nc:task` echo. */
export async function finalizeMergedPr(id: string): Promise<void> {
  await invoke('finalize_merged_pr', { id });
}

/** Fast-forward-only pull of the task's base branch on the PROJECT ROOT after
 *  a remote merge. The backend refuses a dirty root or a non-ff pull — the
 *  rejection message surfaces verbatim in the failure toast. */
export async function pullBaseFf(id: string): Promise<void> {
  await invoke('pull_base_ff', { id });
}

/** Fetch the UNRESOLVED review threads + top-level review summaries for a task's
 *  PR via a bounded `gh api graphql`. Read-only, on-demand (mount + manual
 *  refresh; NO polling). Resolves an empty payload outside Tauri (browser
 *  preview) so the section shows its empty/unavailable note. */
export async function listPrComments(id: string): Promise<PrReviewComments> {
  return tauriInvoke<PrReviewComments>('list_pr_comments', { id }, { threads: [], reviews: [] });
}

/** RE-FETCH the PR review comments server-side, build a fenced fix prompt, and
 *  dispatch a fix run on the task's existing worktree — the fixes flow into the
 *  normal verify → gauntlet path, then the phase-2 Push updates button publishes
 *  them. Rejects loudly (and outside Tauri) — no silent fallback. */
export async function addressPrComments(id: string): Promise<void> {
  await invoke('address_pr_comments', { id });
}

/** RE-FETCH the PR review threads server-side and AI-triage each into
 *  actionable / false_positive / already_addressed / question (aligned to the
 *  thread order by `index`). Read-only + fail-open: the backend classifies a
 *  failed pass as all-actionable, and this resolves an empty array outside Tauri
 *  (browser preview) so the chips simply stay hidden. */
export async function triagePrComments(id: string): Promise<PrCommentTriage[]> {
  return tauriInvoke<PrCommentTriage[]>('triage_pr_comments', { id }, []);
}

