//! The sidecar-side adapter implementing [`crate::engine_api::SessionDispatch`].
//!
//! [`SidecarSessions`] is a zero-sized handle managed as `Arc<dyn SessionDispatch>`
//! in `lib.rs` — the mirror of `orchestration::EngineHandle` for the OTHER
//! direction of the old engine-module cycle (issue #33). Each method delegates to
//! the real sidecar dispatchers, keeping the `crate::sidecar::*` names on this
//! side of the seam so the workflow tier never imports `sidecar`.

use std::path::Path;

use tauri::AppHandle;

use crate::engine_api::SessionDispatch;

/// Zero-sized adapter over the sidecar bridge's session dispatchers. Held as
/// `Arc<dyn SessionDispatch>` so workflow depends on the trait, not the bridge.
pub(crate) struct SidecarSessions;

#[async_trait::async_trait]
impl SessionDispatch for SidecarSessions {
    async fn ensure_reader(&self, app: &AppHandle) -> Result<(), String> {
        super::ensure_reader(app).await
    }

    async fn dispatch_reviewer(
        &self,
        app: &AppHandle,
        task_id: &str,
        worktree_dir: &Path,
    ) -> Result<(), String> {
        super::verification::dispatch_reviewer_for(app, task_id, worktree_dir).await
    }

    async fn dispatch_pr_comment_fix(
        &self,
        app: &AppHandle,
        task_id: &str,
        prompt: &str,
        worktree_dir: &Path,
    ) -> Result<(), String> {
        super::verification::dispatch_pr_comment_fix(app, task_id, prompt, worktree_dir).await
    }

    async fn dispatch_pr_fix_build(
        &self,
        app: &AppHandle,
        fix_id: &str,
        prompt: String,
        dir: &Path,
    ) -> Result<(), String> {
        super::verification::dispatch_pr_fix_build(app, fix_id, prompt, dir).await
    }
}
