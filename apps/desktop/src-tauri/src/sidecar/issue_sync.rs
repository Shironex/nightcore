//! The `sync_issue_status` command — project a task's Nightcore lifecycle onto its linked
//! GitHub issue (§3.6). Async + `spawn_blocking` (the WKWebView rule; it shells to `gh`).
//!
//! Body: settings gate → load task + resolve the linked issue number (lazy `sourceRef`→run
//! backfill for pre-#97 tasks, §2.3) → active-project guard (the root is the `gh` cwd that
//! resolves `{owner}/{repo}`) → compute the writeback delta PURELY (early-out with zero
//! `gh` calls when nothing changed) → acquire the per-root mutation lease → apply the label
//! delta + terminal comment under the degradation ladder → stamp the sync fields
//! best-effort + emit `nc:task`.
//!
//! Nothing auto-FIRES this yet — PR 3 adds the `useIssueSync` web observer that invokes it
//! on `nc:task` transitions. Until then the command is invocable but inert, so PR 2 carries
//! no live GitHub traffic.

use std::collections::{HashMap, HashSet};

use tauri::{AppHandle, Emitter, Manager};

use crate::project::ProjectStore;
use crate::settings::SettingsStore;
use crate::sidecar::lifecycle::apply_and_emit;
use crate::store::issue_triage::IssueValidationStore;
use crate::store::TaskStore;
use crate::task::{Task, TASK_EVENT};
use crate::workflow::issue_sync::{
    apply_writeback, open_issue_in_browser as open_issue_page, pending_work, project_issue_states,
};
use crate::workflow::merge::{acquire_root_lease, require_project};

/// Writeback a task's status to its linked GitHub issue. Off the UI thread (it shells to
/// `gh`). A no-op when sync is disabled, the task links no issue, or nothing changed.
#[tauri::command]
pub async fn sync_issue_status(app: AppHandle, task_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || sync_issue_status_blocking(&app, &task_id))
        .await
        .map_err(|e| format!("issue sync failed to run: {e}"))?
}

fn sync_issue_status_blocking(app: &AppHandle, task_id: &str) -> Result<(), String> {
    // 1. Settings gate — writeback is opt-in (it MUTATES a often-public GitHub repo).
    let settings = app
        .try_state::<SettingsStore>()
        .ok_or_else(|| "settings unavailable".to_string())?;
    let (enabled, prefix) =
        settings.with_settings(|s| (s.issue_sync_enabled, s.label_prefix().to_string()));
    if !enabled {
        return Ok(());
    }

    // 2. Load the task; resolve its linked issue number (lazy backfill via sourceRef→run).
    let store = app
        .try_state::<TaskStore>()
        .ok_or_else(|| "task store unavailable".to_string())?;
    let mut task = store
        .get(task_id)
        .ok_or_else(|| format!("no task with id {task_id}"))?;
    let backfilled = task.issue_number.is_none();
    let issue_number = match task
        .issue_number
        .or_else(|| backfill_issue_number(app, &task))
    {
        Some(n) => n,
        // Not an issue-linked task (or the validation run was pruned) — nothing to sync.
        None => return Ok(()),
    };
    task.issue_number = Some(issue_number);

    // 3. Project guard — the active project's root is the `gh` cwd resolving {owner}/{repo}.
    let project = app
        .state::<ProjectStore>()
        .active()
        .ok_or_else(|| "no active project".to_string())?;
    let project_path = std::path::PathBuf::from(&project.path);

    // 4. Compute the writeback delta PURELY — zero `gh` calls when nothing changed.
    if pending_work(&task, &prefix).is_noop() {
        // A backfilled number still deserves persistence so the next sync skips the run
        // lookup — but that is a pure store write, no GitHub traffic.
        if backfilled {
            if let Ok(updated) = store.mutate(task_id, |t| {
                if t.issue_number.is_none() {
                    t.issue_number = Some(issue_number);
                }
            }) {
                let _ = app.emit(TASK_EVENT, &updated);
            }
        }
        return Ok(());
    }

    // 5. Per-root mutation lease — writeback mutates the shared repo (a GitHub write from
    //    its root), so serialize against merge / commit / pull-base / comment-post.
    let _lease = acquire_root_lease(&project_path, "syncing the issue status")?;

    // 6. Apply the label delta + terminal comment under the degradation ladder.
    let outcome = apply_writeback(&project_path, &prefix, issue_number, &task);

    // 7. Stamp the sync fields best-effort (a store hiccup must not turn a landed GitHub
    //    write into a failure — the `mark_posted` pattern) + emit.
    if outcome.changed {
        match store.mutate(task_id, |t| {
            t.issue_number = Some(issue_number);
            t.issue_synced_label = outcome.synced_label.clone();
            t.issue_synced_at = outcome.synced_at;
            t.issue_comment_marker = outcome.comment_marker.clone();
            t.issue_sync_error = outcome.sync_error.clone();
        }) {
            Ok(updated) => {
                let _ = app.emit(TASK_EVENT, &updated);
            }
            Err(e) => {
                tracing::warn!(target: "nightcore", task_id, error = %e, "failed to stamp issue-sync fields (the GitHub write already landed)");
            }
        }
    }
    Ok(())
}

/// Resolve a pre-#97 issue task's number lazily from its `sourceRef` (`issue-triage:<runId>`)
/// via the validation `RunStore` (§2.3). Best-effort: a pruned run (`MAX_RUNS = 50`) yields
/// `None`, and the task simply never writes back — acceptable.
fn backfill_issue_number(app: &AppHandle, task: &Task) -> Option<u64> {
    let run_id = task.source_ref.as_deref()?.strip_prefix("issue-triage:")?;
    let store = app.try_state::<IssueValidationStore>()?;
    store.get(run_id).map(|r| r.issue_number)
}

/// Projection-IN (#97 PR 4, §5): poll the upstream state of every issue-linked task's
/// GitHub issue and project close/reopen onto `task.issue_state` (the "closed upstream"
/// chip's data). READS ONLY — no mutation lease, no issue write; a merged task is skipped
/// (its issue closing is expected, not a divergence). Off the UI thread (it shells to
/// `gh`). Fired on window focus by the web (gated on `issueSyncEnabled`). Returns the
/// `(issue_number, state)` pairs that CHANGED this poll.
#[tauri::command]
pub async fn poll_issue_states(app: AppHandle) -> Result<Vec<(u64, String)>, String> {
    tauri::async_runtime::spawn_blocking(move || poll_issue_states_blocking(&app))
        .await
        .map_err(|e| format!("polling issue states failed to run: {e}"))?
}

fn poll_issue_states_blocking(app: &AppHandle) -> Result<Vec<(u64, String)>, String> {
    // No active project ⇒ nothing to poll (a background focus poll must not error out).
    let project = match app.state::<ProjectStore>().active() {
        Some(project) => project,
        None => return Ok(Vec::new()),
    };
    let store = app
        .try_state::<TaskStore>()
        .ok_or_else(|| "task store unavailable".to_string())?;

    // The DISTINCT linked issue numbers of tasks we still care about (not merged).
    let mut linked: Vec<u64> = Vec::new();
    let mut seen: HashSet<u64> = HashSet::new();
    for task in store.list() {
        if task.merged {
            continue;
        }
        if let Some(number) = task.issue_number {
            if seen.insert(number) {
                linked.push(number);
            }
        }
    }
    // Zero linked issues ⇒ zero `gh` calls (the natural guard: only a GitHub project
    // with issue-linked tasks ever talks to the network here).
    if linked.is_empty() {
        return Ok(Vec::new());
    }

    let by_number: HashMap<u64, String> =
        project_issue_states(std::path::Path::new(&project.path), &linked)?
            .into_iter()
            .map(|projection| (projection.number, projection.state))
            .collect();

    // Project the last-observed state onto each affected task, emitting only on a CHANGE
    // (last-write-wins; never mutates anything but `issue_state`).
    let mut changed: Vec<(u64, String)> = Vec::new();
    for task in store.list() {
        if task.merged {
            continue;
        }
        let Some(number) = task.issue_number else {
            continue;
        };
        let Some(state) = by_number.get(&number) else {
            continue;
        };
        if task.issue_state.as_deref() == Some(state.as_str()) {
            continue;
        }
        let next = state.clone();
        apply_and_emit(app, store.inner(), &task.id, {
            let next = next.clone();
            move |t| t.issue_state = Some(next)
        });
        changed.push((number, next));
    }
    Ok(changed)
}

/// Open a linked issue on GitHub in the user's browser — the "closed upstream" chip's
/// click action (§5). READ-ONLY (`gh issue view <n> --web`; it opens a page, never
/// mutates the issue). Off the UI thread (it shells to `gh`).
#[tauri::command]
pub async fn open_issue_in_browser(app: AppHandle, issue_number: u64) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let project = require_project(&app)?;
        open_issue_page(std::path::Path::new(&project.path), issue_number)
    })
    .await
    .map_err(|e| format!("opening the issue failed to run: {e}"))?
}
