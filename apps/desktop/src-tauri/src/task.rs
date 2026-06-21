//! The task model and the CRUD commands over the task registry.
//!
//! A `Task` is the unit of work the studio orchestrates: a prompt with a
//! lifecycle. M1 owns creating, editing, deleting, listing, and persisting
//! tasks; running one through the sidecar lives in `sidecar.rs`. Every mutation
//! goes through the [`TaskStore`](crate::store::TaskStore) (persist) and emits
//! `nc:task` (the full task) so the webview can upsert its board by id.

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, State};

use crate::store::TaskStore;

/// The Tauri event carrying a single task to the webview. The UI upserts its
/// board state by `task.id`, so every create/update/status change re-emits this.
pub const TASK_EVENT: &str = "nc:task";

/// Where a task sits in its lifecycle. `ready` and `waiting_approval` are
/// reserved in M1 (defined, not yet produced): the auto-loop and interactive
/// approval that drive them arrive in M2.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Backlog,
    Ready,
    InProgress,
    WaitingApproval,
    Done,
    Failed,
}

/// One unit of orchestrated work. Field names mirror the M1 contract exactly and
/// serialize camelCase for the TS bridge and the on-disk JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub description: String,
    pub status: TaskStatus,
    /// Other task ids this one depends on. Stored in M1, enforced in M2.
    pub dependencies: Vec<String>,
    /// `None` means "use the core/config default model".
    pub model: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    /// Sidecar session id of the last/current run, set once a run starts.
    pub session_id: Option<u64>,
    /// Result text on success.
    pub summary: Option<String>,
    /// Failure message on a failed run.
    pub error: Option<String>,
    /// Cost of the last run in USD.
    pub cost_usd: Option<f64>,
}

impl Task {
    /// Build a fresh backlog task with a generated uuid and matching timestamps.
    pub fn new(title: String, description: String) -> Self {
        let now = now_ms();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            title,
            description,
            status: TaskStatus::Backlog,
            dependencies: Vec::new(),
            model: None,
            created_at: now,
            updated_at: now,
            session_id: None,
            summary: None,
            error: None,
            cost_usd: None,
        }
    }

    /// The prompt sent to the sidecar: title, then the description on a blank line
    /// when it is non-empty.
    pub fn prompt(&self) -> String {
        if self.description.is_empty() {
            self.title.clone()
        } else {
            format!("{}\n\n{}", self.title, self.description)
        }
    }
}

/// A partial update to a task — every field optional so the webview can patch
/// just what changed. Absent fields are left untouched.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPatch {
    pub title: Option<String>,
    pub description: Option<String>,
    pub status: Option<TaskStatus>,
    pub dependencies: Option<Vec<String>>,
    pub model: Option<String>,
}

/// Current epoch time in milliseconds. Used for `created_at`/`updated_at`; we use
/// `SystemTime` rather than pulling in `chrono` for one timestamp.
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// --- Commands ---------------------------------------------------------------

/// All tasks currently in the registry (unordered; the webview groups by status).
#[tauri::command]
pub fn list_tasks(store: State<'_, TaskStore>) -> Result<Vec<Task>, String> {
    Ok(store.list())
}

/// Create a new backlog task, persist it, and emit `nc:task`.
#[tauri::command]
pub fn create_task(
    app: AppHandle,
    store: State<'_, TaskStore>,
    title: String,
    description: String,
) -> Result<Task, String> {
    let task = Task::new(title, description);
    store.upsert(&task)?;
    let _ = app.emit(TASK_EVENT, &task);
    Ok(task)
}

/// Apply a partial update to a task, bump `updated_at`, persist, and emit
/// `nc:task`. Errors if the id is unknown.
#[tauri::command]
pub fn update_task(
    app: AppHandle,
    store: State<'_, TaskStore>,
    id: String,
    patch: TaskPatch,
) -> Result<Task, String> {
    let task = store.mutate(&id, |task| {
        if let Some(title) = patch.title {
            task.title = title;
        }
        if let Some(description) = patch.description {
            task.description = description;
        }
        if let Some(status) = patch.status {
            task.status = status;
        }
        if let Some(dependencies) = patch.dependencies {
            task.dependencies = dependencies;
        }
        // `model` is itself nullable, so a present patch can clear it back to None.
        if patch.model.is_some() {
            task.model = patch.model;
        }
    })?;
    let _ = app.emit(TASK_EVENT, &task);
    Ok(task)
}

/// Delete a task and remove its JSON file. No-op event; the webview drops the id
/// on the command's success.
#[tauri::command]
pub fn delete_task(store: State<'_, TaskStore>, id: String) -> Result<(), String> {
    store.remove(&id)
}
