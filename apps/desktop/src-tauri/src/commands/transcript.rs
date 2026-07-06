//! The transcript-read command (M4.7 §C).
//!
//! Thin Tauri wrapper over the store's transcript reader. The persistence itself
//! — the per-task JSONL writer, the tail-bounded reader, and the deletion path —
//! lives in [`crate::store::transcript`], which stays a pure leaf with no
//! `#[tauri::command]` of its own. This module holds the ONE command that reads a
//! task's transcript back to the web, mirroring the `commands/*` split where a
//! command is a thin shell over store logic.

use serde_json::Value;
use tauri::State;

use crate::store::TaskStore;

/// Return a task's persisted transcript events (tail-bounded). The web reseeds its
/// `nc:session` stream view from this on mount / when a task is opened, so a reload
/// no longer blanks the transcript (M4.7 §C).
#[tauri::command]
pub fn read_transcript(store: State<'_, TaskStore>, task_id: String) -> Result<Vec<Value>, String> {
    Ok(crate::transcript::read_events(&store.tasks_dir(), &task_id))
}
