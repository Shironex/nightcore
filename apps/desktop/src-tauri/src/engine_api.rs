//! The engine's command surface as seen by the sidecar bridge — and the sidecar's
//! session-dispatch surface as seen by the workflow tier.
//!
//! The sidecar reader and command handlers need a handful of run-engine operations
//! (slot release/abort, the permission registry, the circuit breaker, the worktree
//! cleanup, the auto-loop kick + state emit, and the shared `submit_run`/`interrupt`
//! flows). Reaching for `crate::orchestration::coordinator::Orchestrator` directly
//! made `sidecar` depend on `orchestration`, closing a module cycle. [`EngineApi`]
//! is the seam that breaks it: it names exactly those operations against an opaque
//! `AppHandle`, with the concrete adapter (`orchestration::EngineHandle`) living on
//! the engine side.
//!
//! [`SessionDispatch`] is the SAME move in the other direction (issue #33): the
//! workflow commands (`rerun_verification`, `address_pr_comments`, the pr-fix
//! starters) need to start sidecar sessions, and reaching for `crate::sidecar::*`
//! directly re-grew a workflow ⇄ sidecar cycle. The concrete adapter
//! (`sidecar::SidecarSessions`) lives on the sidecar side; workflow consumes it as
//! a managed `Arc<dyn SessionDispatch>`.
//!
//! This module depends only on `std` + `tauri` + `async_trait` — never on
//! `crate::orchestration` or `crate::sidecar` — so each tier can call the other
//! through its managed trait object without importing it.

use std::path::Path;

use tauri::AppHandle;

/// The run-engine operations the sidecar bridge invokes. Each method takes the
/// `AppHandle` and resolves the live engine from managed state inside the adapter,
/// so the bridge holds only `State<Arc<dyn EngineApi>>` and never names the
/// `Orchestrator`.
#[async_trait::async_trait]
pub trait EngineApi: Send + Sync {
    /// Abort a task's run driver (if attached) and release its slot. Preserved seam:
    /// `cancel_task` now KEEPS the slot leased until the run's terminal event releases
    /// it (so a cancel→re-run can't cross-wire a stale terminal onto the new run), so
    /// this is unused today — kept for a future provider whose run is a local driver
    /// task that cancel must abort (paired with `SlotManager::attach_abort`).
    #[allow(dead_code)]
    fn slots_abort(&self, app: &AppHandle, task_id: &str);
    /// Release a task's concurrency slot. Idempotent.
    fn slots_release(&self, app: &AppHandle, task_id: &str);
    /// Drop a single resolved permission request from a task's parked set. Returns
    /// whether it was actually parked.
    fn permissions_resolve(&self, app: &AppHandle, task_id: &str, request_id: &str) -> bool;
    /// Take and remove every permission request still parked for a task.
    fn permissions_drain_task(&self, app: &AppHandle, task_id: &str) -> Vec<String>;
    /// Record a parked permission request for a task.
    fn permissions_register(&self, app: &AppHandle, task_id: &str, request_id: &str);
    /// Clear the circuit-breaker failure window on a successful run.
    fn breaker_record_success(&self, app: &AppHandle);
    /// Record a failure; returns whether THIS failure tripped the breaker.
    fn breaker_record_failure(&self, app: &AppHandle) -> bool;
    /// Record a FATAL-setup failure (an `auth`/`disk-full` error category): trips
    /// the breaker at once regardless of the sliding-window threshold. Returns
    /// whether THIS failure tripped it. Distinct from [`Self::breaker_record_failure`]
    /// so the auto-loop stops immediately on a broken credential/full disk instead
    /// of burning more tasks that will fail identically.
    fn breaker_record_fatal(&self, app: &AppHandle) -> bool;
    /// The configured trip threshold (for diagnostics / the `nc:loop` payload).
    fn breaker_threshold(&self, app: &AppHandle) -> usize;
    /// Wake the coordinator to run a tick now.
    fn kick(&self, app: &AppHandle);
    /// Emit `nc:loop` with the current loop snapshot.
    fn emit_state(&self, app: &AppHandle, state: &str, reason: Option<&str>);
    /// Fail-closed: deny every permission request still parked for a task.
    async fn deny_parked_permissions(&self, app: &AppHandle, task_id: &str);
    /// Interrupt every in-flight run (the circuit-breaker pause path).
    async fn interrupt_all(&self, app: &AppHandle);
    /// The shared launch sequence behind the auto-loop and the manual `run_task`
    /// command. `feed_breaker` feeds the circuit breaker only for the auto-loop.
    async fn submit_run(
        &self,
        app: &AppHandle,
        task_id: &str,
        feed_breaker: bool,
    ) -> Result<(), String>;
}

/// The sidecar session operations the workflow tier invokes (issue #33). Each
/// method takes the `AppHandle` and resolves the live sidecar bridge from managed
/// state inside the adapter (`sidecar::SidecarSessions`), so workflow holds only
/// `State<Arc<dyn SessionDispatch>>` and never names `crate::sidecar`.
#[async_trait::async_trait]
pub trait SessionDispatch: Send + Sync {
    /// Ensure the sidecar child is spawned and its stdout reader installed.
    /// Callers invoke this BEFORE flipping task state so a spawn failure can
    /// roll back cheaply (the slot is released, nothing was dispatched).
    async fn ensure_reader(&self, app: &AppHandle) -> Result<(), String>;
    /// Start the read-only reviewer session over a build's worktree (M4 §B) —
    /// the `rerun_verification` re-dispatch path.
    async fn dispatch_reviewer(
        &self,
        app: &AppHandle,
        task_id: &str,
        worktree_dir: &Path,
    ) -> Result<(), String>;
    /// Start a fix-build session for GitHub PR review comments (PR arc, phase 3)
    /// with a READY-BUILT, fenced prompt used verbatim.
    async fn dispatch_pr_comment_fix(
        &self,
        app: &AppHandle,
        task_id: &str,
        prompt: &str,
        worktree_dir: &Path,
    ) -> Result<(), String>;
    /// Start a pr-fix session over a managed PR checkout: correlation id = the
    /// FIX id (the reader intercept's routing key), `kind=build`, default
    /// permission mode, project-scoped guardrails (a pr-fix has no task).
    async fn dispatch_pr_fix_build(
        &self,
        app: &AppHandle,
        fix_id: &str,
        prompt: String,
        dir: &Path,
    ) -> Result<(), String>;
}
