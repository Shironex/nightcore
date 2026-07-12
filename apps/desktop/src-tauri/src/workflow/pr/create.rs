//! The create-PR command and its orchestration: the thin sequencer that holds the
//! per-task single-flight guard and drives the extracted steps in merge's order —
//! preconditions + gauntlets ([`super::preconditions`]), ref resolution
//! ([`super::refs`]), the `Closes #N` body prep ([`super::closes`]), the push
//! ([`crate::worktree::push_branch`]), and the `gh pr create` seam with `gh pr
//! view` idempotency recovery ([`super::gh_seam`]).

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Emitter, Manager};

use super::closes::ensure_closes_keyword;
use super::gh_seam::{create_or_recover_with, PrCreateOutcome};
use super::preconditions::{
    check_pr_preconditions, readiness_failure_message, structure_lock_failure_message,
};
use super::refs::resolve_branch_and_base;
use crate::gauntlet;
use crate::gauntlet_project;
use crate::git::gh::GH_BINARY;
use crate::store::TaskStore;
use crate::task::{Task, TASK_EVENT};
use crate::workflow::merge::{require_project, TaskLease};
use crate::worktree;

/// Per-task single-flight guard for PR creation (the pattern of
/// `commit_in_flight`/`merge_in_flight` in [`crate::workflow::merge`]): a double-fired
/// command must not race two pushes + two `gh pr create` runs for one task.
/// `pub(crate)` so `merge_task_blocking` can refuse while a creation is live.
pub(crate) fn pr_in_flight() -> &'static Mutex<HashSet<String>> {
    static IN_FLIGHT: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    IN_FLIGHT.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Refuse PR creation while a sibling terminal action (merge / commit) holds
/// the task. The three in-flight sets are per-action, so without this a merge
/// and a create-PR could run concurrently on one task — and a completing merge
/// (with `cleanup_worktrees` on) deletes the worktree + branch out from under
/// the in-flight push/`gh` spawn. Checked AFTER the PR lease is acquired (the
/// mirror check in `merge` runs after ITS lease), so whichever action leases
/// second reliably sees the other's lease.
fn refuse_while_sibling_in_flight(id: &str) -> Result<(), String> {
    use crate::workflow::merge::{commit_in_flight, lease_held, merge_in_flight};
    if lease_held(merge_in_flight(), id) {
        return Err(
            "a merge for this task is in progress — wait for it to finish before creating a PR"
                .to_string(),
        );
    }
    if lease_held(commit_in_flight(), id) {
        return Err(
            "a commit for this task is in progress — wait for it to finish before creating a PR"
                .to_string(),
        );
    }
    Ok(())
}

/// Push a task's worktree branch to `origin` and create a GitHub PR against
/// `base` (defaulting to the task's chosen base, else the project's current
/// branch). Requires the merge bar: worktree mode + committed + verified + a
/// passing readiness/structure-lock gauntlet. On success persists
/// `pr_url`/`pr_number` on the task and emits `nc:task`.
#[tauri::command]
pub async fn create_pr_task(
    app: AppHandle,
    id: String,
    base: Option<String>,
    title: String,
    body: String,
    draft: bool,
) -> Result<(), String> {
    // Gauntlets + push + `gh` are seconds of blocking work; run on the blocking
    // pool and await so the UI thread stays free (the WKWebView rule).
    tauri::async_runtime::spawn_blocking(move || {
        create_pr_task_blocking(&app, &id, base, &title, &body, draft)
    })
    .await
    .map_err(|e| format!("create PR failed to run: {e}"))?
}

/// The blocking body of `create_pr_task`, mirroring `merge_task_blocking`'s
/// order: lease → load → preconditions → gauntlets → resolve refs → push →
/// create → persist + emit.
fn create_pr_task_blocking(
    app: &AppHandle,
    id: &str,
    base: Option<String>,
    title: &str,
    body: &str,
    draft: bool,
) -> Result<(), String> {
    // Single-flight per task: refuse a second concurrent PR creation instead of
    // racing (held for the whole gauntlet→push→create body; released on every exit).
    let _lease = TaskLease::acquire(pr_in_flight(), id)
        .ok_or_else(|| "a PR creation for this task is already in progress".to_string())?;
    // Cross-action serialization: never push/create under an in-flight merge or
    // commit on the same task (see `refuse_while_sibling_in_flight`).
    refuse_while_sibling_in_flight(id)?;
    let store = app
        .try_state::<TaskStore>()
        .ok_or_else(|| "task store unavailable".to_string())?;
    let task = store
        .get(id)
        .ok_or_else(|| format!("no task with id {id}"))?;
    let project = require_project(app)?;
    let project_path = std::path::PathBuf::from(&project.path);

    // Preconditions: worktree mode (a main-mode task has no branch to push),
    // committed, verified — the same bar as merge.
    check_pr_preconditions(&task)?;

    // Unlike merge (which can integrate a branch after its worktree is gone), the
    // push + `gh` spawn both run IN the worktree dir, so it must exist.
    let worktree_dir = worktree::worktree_path(&project_path, id);
    if !worktree_dir.exists() {
        return Err(format!(
            "no worktree for task {id} — run it before creating a PR"
        ));
    }
    // A fresh worktree checks out NO `node_modules` (gitignored), and non-hoisted,
    // package-local deps in the main checkout are invisible to it, so `tsc -b` fails
    // with "Cannot find module …" (exit 2) until the worktree is installed from its
    // committed lockfile. Provision deterministically BEFORE the gauntlet so the
    // checks run against a real, resolvable environment (a no-op for non-JS projects).
    worktree::provision_deps(&worktree_dir)?;
    // The same gates merge_task_blocking runs (M4 §D + feature #3): a PR must not
    // be a side door around the readiness or structure-lock gauntlets. Reject on
    // failure — never force. Absent harness manifest ⇒ no lock checks ⇒ pass.
    let result = gauntlet::run(&worktree_dir);
    if !result.passed {
        return Err(readiness_failure_message(&result));
    }
    let lock = gauntlet_project::run(&worktree_dir);
    if !lock.passed {
        return Err(structure_lock_failure_message(&lock));
    }

    // The gauntlets run for SECONDS — wide enough for a parallel actor (a second
    // window, a completed merge, an earlier create) to change the task's publish
    // state. Re-read the task from the store and re-check the preconditions just
    // before anything leaves the machine, closing that window.
    let task = store
        .get(id)
        .ok_or_else(|| format!("no task with id {id}"))?;
    check_pr_preconditions(&task)?;

    // Branch + base honor the create dialog's picker, defaulting like merge does;
    // both are validated before they reach any argv (refs are git's injection
    // surface).
    let (branch, base) =
        resolve_branch_and_base(&task, id, base, || worktree::base_branch(&project_path))?;

    tracing::info!(target: "nightcore::pr", task_id = %id, branch = %branch, base = %base, draft, "pushing branch to origin for PR");
    // Plain push, never --force; `-u` sets the upstream so later pushes/status
    // reads resolve. Idempotent — a retry after a failed create just re-pushes.
    worktree::push_branch(&worktree_dir, &branch)?;

    // GitHub two-way sync (#97, §3.5): defensively guarantee an issue-linked task's
    // PR carries `Closes #N` so a merge auto-closes the issue natively (Nightcore
    // never issues an explicit close). Idempotent — the dialog already pre-filled it
    // (draft path), so this only re-adds it if the user edited the keyword out, and
    // never duplicates one that is present. `Closes #N` needs no issue-write scope
    // (it rides the PR body the user already has push rights to), so it is unaffected
    // by the sync-enabled toggle or the degradation ladder.
    let body = match task.issue_number {
        Some(n) => ensure_closes_keyword(body, n),
        None => body.to_string(),
    };

    let (url, number) = match create_or_recover_with(
        &worktree_dir,
        GH_BINARY,
        &branch,
        &base,
        title,
        &body,
        draft,
    ) {
        PrCreateOutcome::Created { url, number } => (url, number),
        PrCreateOutcome::ToolAbsent => {
            return Err(
                "GitHub CLI (`gh`) is not installed — install it to create pull requests"
                    .to_string(),
            )
        }
        // gh's stderr is surfaced verbatim: it already explains itself (e.g.
        // "a pull request for branch … already exists" — though that exact shape
        // is normally recovered by the `gh pr view` net above).
        PrCreateOutcome::Failed { message } => return Err(message),
    };

    let updated = persist_created_pr(&store, id, &url, number, &base)?;
    tracing::info!(target: "nightcore::pr", task_id = %id, pr_number = number, "created pull request");
    let _ = app.emit(TASK_EVENT, &updated);
    Ok(())
}

/// Persist a created PR on the task: `pr_url`/`pr_number` plus the RESOLVED
/// base it was opened against. Grounding `base_branch` here is what keeps the
/// whole later chain honest — the pull-base fast-forward and the confirm-dialog
/// copy both key on `task.base_branch`, so a task created against the project's
/// then-current branch must remember it instead of leaving `None` (which used
/// to make the pull re-guess from whatever branch the root happens to be on).
/// Store-only (no `AppHandle`), so the persistence is unit-testable.
fn persist_created_pr(
    store: &TaskStore,
    id: &str,
    url: &str,
    number: u64,
    base: &str,
) -> Result<Task, String> {
    store.mutate(id, |t| {
        t.pr_url = Some(url.to_string());
        t.pr_number = Some(number);
        t.base_branch = Some(base.to_string());
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::task::RunMode;

    /// A task that clears every PR precondition (worktree + committed + verified).
    fn ready_task() -> Task {
        let mut task =
            Task::new("Add login".into(), "OAuth flow".into()).with_run_mode(RunMode::Worktree);
        task.committed = true;
        task.verified = true;
        task
    }

    #[test]
    fn create_pr_refused_while_merge_or_commit_holds_the_task() {
        use crate::workflow::merge::{commit_in_flight, merge_in_flight};
        // Merge direction: a live merge blocks PR creation (its cleanup would
        // delete the worktree/branch mid-push). Unique ids: the sets are global.
        let merge_lease =
            TaskLease::acquire(merge_in_flight(), "pr-vs-merge").expect("merge lease");
        let err = refuse_while_sibling_in_flight("pr-vs-merge").expect_err("create is refused");
        assert!(err.contains("merge"), "names the conflicting action: {err}");
        drop(merge_lease);
        assert!(refuse_while_sibling_in_flight("pr-vs-merge").is_ok());

        // Commit direction: a live commit blocks PR creation too (the push
        // would race the in-progress stage/commit of the same worktree).
        let commit_lease =
            TaskLease::acquire(commit_in_flight(), "pr-vs-commit").expect("commit lease");
        let err = refuse_while_sibling_in_flight("pr-vs-commit").expect_err("create is refused");
        assert!(
            err.contains("commit"),
            "names the conflicting action: {err}"
        );
        // Other tasks are unaffected, and dropping the lease frees this one.
        assert!(refuse_while_sibling_in_flight("pr-vs-commit-other").is_ok());
        drop(commit_lease);
        assert!(refuse_while_sibling_in_flight("pr-vs-commit").is_ok());
    }

    #[test]
    fn persist_created_pr_grounds_url_number_and_base() {
        let tmp = tempfile::TempDir::new().expect("store dir");
        let store = TaskStore::load_from(tmp.path().join("tasks"));
        let task = ready_task();
        let id = task.id.clone();
        store.upsert(&task).expect("seed");

        let updated =
            persist_created_pr(&store, &id, "https://github.com/a/b/pull/7", 7, "develop")
                .expect("persist");
        assert_eq!(
            updated.pr_url.as_deref(),
            Some("https://github.com/a/b/pull/7")
        );
        assert_eq!(updated.pr_number, Some(7));
        assert_eq!(
            updated.base_branch.as_deref(),
            Some("develop"),
            "the RESOLVED base is grounded on the task at creation"
        );
        // Persisted via the store, not just returned.
        let stored = store.get(&id).expect("task");
        assert_eq!(stored.base_branch.as_deref(), Some("develop"));
    }
}
