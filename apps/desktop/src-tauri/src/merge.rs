//! Commit / merge of verified tasks (M3 §D).
//!
//! Git ops confined to a task's worktree (`commit`) or run as a plain `git merge`
//! into the project base (`merge`, never `--force`). On a clean merge we honor the
//! `cleanupWorktrees` setting; on a conflict the merge is aborted and the task is
//! marked `conflict` for the UI — never forced. Every transition emits `nc:task`.

use tauri::{AppHandle, Emitter, Manager, State};

use crate::m2::worktree::{self, MergeOutcome};
use crate::project::{Project, ProjectStore};
use crate::settings::SettingsStore;
use crate::store::TaskStore;
use crate::task::{Task, TASK_EVENT};

/// The active project, or an error message for a command that needs one.
fn require_project(app: &AppHandle) -> Result<Project, String> {
    app.state::<ProjectStore>()
        .active()
        .ok_or_else(|| "no active project".to_string())
}

/// The commit message for a task: its title, or a fallback when blank.
fn commit_message(task: &Task) -> String {
    let title = task.title.trim();
    if title.is_empty() {
        format!("nightcore: task {}", task.id)
    } else {
        title.to_string()
    }
}

/// Commit a task's worktree: `git add -A` + commit with a message from the task
/// title. Confined to the task's worktree. Surfaces "nothing to commit" as an
/// error so the UI can show it; marks the task committed on success.
#[tauri::command]
pub fn commit_task(app: AppHandle, store: State<'_, TaskStore>, id: String) -> Result<(), String> {
    let task = store.get(&id).ok_or_else(|| format!("no task with id {id}"))?;
    let project = require_project(&app)?;
    let message = commit_message(&task);

    let committed = worktree::commit(&std::path::PathBuf::from(&project.path), &id, &message)?;
    if !committed {
        return Err("nothing to commit".to_string());
    }
    let updated = store.mutate(&id, |t| {
        t.committed = true;
        t.conflict = false;
    })?;
    let _ = app.emit(TASK_EVENT, &updated);
    Ok(())
}

/// Merge a task's `nc/<taskId>` branch into the project base branch. On success,
/// honor `cleanupWorktrees` (remove the worktree + delete the branch) and mark the
/// task merged; on conflict, mark `conflict` and surface an error (never forced).
#[tauri::command]
pub fn merge_task(app: AppHandle, store: State<'_, TaskStore>, id: String) -> Result<(), String> {
    store.get(&id).ok_or_else(|| format!("no task with id {id}"))?;
    let project = require_project(&app)?;
    let project_path = std::path::PathBuf::from(&project.path);
    let base = worktree::base_branch(&project_path);

    match worktree::merge(&project_path, &id, &base)? {
        MergeOutcome::Merged => {
            let cleanup = app.state::<SettingsStore>().get().cleanup_worktrees;
            if cleanup {
                let _ = worktree::remove(&project_path, &id);
                let _ = worktree::delete_branch(&project_path, &id);
            }
            let updated = store.mutate(&id, |t| {
                t.merged = true;
                t.conflict = false;
            })?;
            let _ = app.emit(TASK_EVENT, &updated);
            Ok(())
        }
        MergeOutcome::Conflict => {
            let updated = store.mutate(&id, |t| {
                t.conflict = true;
                t.error = Some(format!(
                    "merge conflict integrating {} into {base}",
                    t.branch.clone().unwrap_or_default()
                ));
            })?;
            let _ = app.emit(TASK_EVENT, &updated);
            Err(format!("merge conflict integrating into {base}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commit_message_uses_title_or_falls_back() {
        let mut task = Task::new("Add login form".into(), String::new());
        assert_eq!(commit_message(&task), "Add login form");

        task.title = "   ".into();
        assert!(commit_message(&task).contains(&task.id));
    }
}
