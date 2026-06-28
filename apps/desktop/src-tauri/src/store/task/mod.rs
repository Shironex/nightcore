//! The task model facade over the task registry's persistence leaf.
//!
//! A `Task` is the unit of work the studio orchestrates: a prompt with a
//! lifecycle. This module is a pure persistence leaf: the data model lives in
//! [`model`] and the TaskStore-facing CRUD helpers in [`crud`]. The
//! `#[tauri::command]` handlers that drive it (and their orchestration up-calls)
//! moved up to the command layer in [`crate::commands::task`]. Every mutation still
//! goes through the [`TaskStore`](crate::store::TaskStore) (persist) and emits
//! [`TASK_EVENT`] (`nc:task`, the full task) so the webview can upsert its board by
//! id.

mod crud;
mod model;

// Module facade: preserve the historical `crate::task::*` paths after the god-file
// split so call sites elsewhere (`commands::task`, `contracts`, `store/mod.rs`, the
// `sidecar`/`workflow`/`orchestration` modules) keep resolving unchanged. The crud
// helpers (`convert_one`/`move_task_inner`) are re-exported `pub(crate)` so the
// moved command handlers in `commands::task` can reach them through this facade.
pub(crate) use crud::*;
pub use model::*;

/// The Tauri event carrying a single task to the webview. The UI upserts its
/// board state by `task.id`, so every create/update/status change re-emits this.
pub const TASK_EVENT: &str = "nc:task";
