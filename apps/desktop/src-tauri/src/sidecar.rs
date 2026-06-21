//! The persistent provider sidecar reader and the run/cancel commands.
//!
//! Protocol (line-delimited JSON over the child's stdio):
//!   - we WRITE one `SurfaceCommand` JSON object per line to the sidecar's stdin
//!   - we READ one `NightcoreEvent` JSON object per line from its stdout
//!   - the sidecar's stderr is human logs; we inherit it
//!
//! M2 generalizes M1's single-task serial path to N concurrent sessions through
//! ONE persistent sidecar (the engine's `SessionManager` already multiplexes
//! sessions). The change from M1: the reader correlates each event to a task via
//! the provider's `sessionId → taskId` map (M1 tagged everything with the single
//! `active_task`). Concurrency is bounded by the [`SlotManager`]; a run holds a
//! slot from lease until its terminal event releases it.
//!
//! `run_task` stays as the manual single-run path (useful even with the loop):
//! it leases a slot, allocates a worktree, and dispatches — exactly what the
//! coordinator's `launch` does, just triggered by a click instead of a tick.

use std::path::PathBuf;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::m2::coordinator::{self, Orchestrator};
use crate::m2::provider::{parse_line, PermissionDecision, Provider};
use crate::m2::worktree;
use crate::project::ProjectStore;
use crate::store::TaskStore;
use crate::task::{Task, TaskStatus, TASK_EVENT};

/// The Tauri event carrying one streamed sidecar event for a task.
/// Payload: `{ taskId: string, event: NightcoreEvent }`.
pub const SESSION_EVENT: &str = "nc:session";

/// The Tauri event carrying an interactive permission prompt for a task. Payload:
/// `{ taskId, requestId, toolName, input, suggestions? }`. The webview renders the
/// prompt and answers via the `respond_permission` command. Permission inputs may
/// contain paths/commands — they are surfaced to the UI but NEVER logged.
pub const PERMISSION_EVENT: &str = "nc:permission";

/// The tool name the SDK uses when the agent finishes a plan in `plan` mode. It
/// surfaces as a `permission-required`; the core gates it as plan approval rather
/// than a generic tool prompt.
const EXIT_PLAN_MODE: &str = "ExitPlanMode";

/// Ensure the persistent sidecar is running and its stdout reader is installed.
/// Idempotent: spawns lazily on first use, then a no-op. Shared by `run_task` and
/// the coordinator's `launch`.
pub async fn ensure_reader(app: &AppHandle) -> Result<(), String> {
    let orch = app.state::<Orchestrator>();
    let Some(stdout) = orch.provider.spawn().await? else {
        return Ok(()); // already running
    };

    // The reader outlives every individual run: it streams the single persistent
    // sidecar's stdout for the whole app lifetime, correlating each event to its
    // task and applying terminal transitions + slot release + worktree cleanup.
    let app = app.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(raw)) => match parse_line(&raw) {
                    Some(Ok(event)) => handle_event(&app, event).await,
                    Some(Err(e)) => eprintln!("{e}"),
                    None => {}
                },
                Ok(None) => break, // stdout closed: sidecar exited
                Err(e) => {
                    eprintln!("error reading sidecar stdout: {e}");
                    break;
                }
            }
        }
    });

    Ok(())
}

/// Process one parsed sidecar event: correlate it to its task, forward it as
/// `nc:session`, auto-deny permission requests, and apply terminal transitions
/// (releasing the slot, cleaning up the worktree, feeding the breaker, kicking the
/// coordinator).
async fn handle_event(app: &AppHandle, event: Value) {
    let orch = app.state::<Orchestrator>();
    let store = app.state::<TaskStore>();

    let event_type = event.get("type").and_then(Value::as_str).unwrap_or("");
    let session_id = event.get("sessionId").and_then(Value::as_u64);

    // Correlate the event to its task. The first sighting of a session id binds it
    // to the task at the front of the pending-launch FIFO; later events read back
    // the binding. An uncorrelatable event (no pending launch) is dropped.
    let Some(task_id) = session_id.and_then(|sid| orch.provider.correlate(sid)) else {
        return;
    };

    // Forward the raw event to the webview tagged with its task.
    let _ = app.emit(
        SESSION_EVENT,
        serde_json::json!({ "taskId": task_id, "event": event }),
    );

    // M3: a permission request is relayed, not auto-denied. The plan gate
    // (`ExitPlanMode`) transitions the task to `waiting_approval` and stores the
    // plan; any other tool surfaces an interactive `nc:permission` prompt. Both
    // park in the engine until `respond_permission` (or a fail-closed deny on
    // cancel) resolves them.
    if event_type == "permission-required" {
        if let Some(request_id) = event.get("requestId").and_then(Value::as_str) {
            let tool_name = event.get("toolName").and_then(Value::as_str).unwrap_or("");
            orch.permissions.register(&task_id, request_id);
            if tool_name == EXIT_PLAN_MODE {
                handle_plan_gate(app, &store, &task_id, &event);
            } else {
                emit_permission_prompt(app, &task_id, request_id, &event);
            }
        }
        return;
    }

    match event_type {
        "session-started" | "session-ready" => {
            if let Some(sid) = session_id {
                apply_and_emit(app, &store, &task_id, |task| {
                    task.session_id = Some(sid);
                });
            }
        }
        "session-completed" => {
            apply_and_emit(app, &store, &task_id, |task| {
                task.status = TaskStatus::Done;
                task.summary = event
                    .get("result")
                    .and_then(Value::as_str)
                    .map(|s| s.to_string());
                task.cost_usd = event.get("costUsd").and_then(Value::as_f64);
                task.session_id = session_id;
                task.error = None;
            });
            finish_run(app, &task_id, session_id, Outcome::Succeeded);
        }
        "session-failed" => {
            // A user-initiated cancel or a circuit-breaker pause interrupts the run
            // and surfaces as `session-failed { reason: "aborted" }`. An abort is
            // not a "broken setup" signal, so it must NOT count toward the breaker
            // (otherwise cancelling a few tasks would trip it).
            let aborted = event.get("reason").and_then(Value::as_str) == Some("aborted");
            apply_and_emit(app, &store, &task_id, |task| {
                task.status = TaskStatus::Failed;
                task.error = event
                    .get("message")
                    .and_then(Value::as_str)
                    .map(|s| s.to_string());
                task.session_id = session_id;
            });
            let outcome = if aborted {
                Outcome::Aborted
            } else {
                Outcome::Failed
            };
            finish_run(app, &task_id, session_id, outcome);
        }
        _ => {}
    }
}

/// Surface an interactive permission prompt to the webview as `nc:permission`.
/// Forwards the tool name + input (which may contain paths/commands — never
/// logged) plus the SDK's `suggestions`, when present, so the UI can offer
/// pre-filled allow/deny choices.
fn emit_permission_prompt(app: &AppHandle, task_id: &str, request_id: &str, event: &Value) {
    let _ = app.emit(
        PERMISSION_EVENT,
        serde_json::json!({
            "taskId": task_id,
            "requestId": request_id,
            "toolName": event.get("toolName").and_then(Value::as_str).unwrap_or(""),
            "input": event.get("input").cloned().unwrap_or(Value::Null),
            "suggestions": event.get("suggestions").cloned(),
        }),
    );
}

/// The plan-approval gate (M3 §C): the agent finished a plan in `plan` mode and
/// called `ExitPlanMode`, surfacing as a `permission-required`. Transition the task
/// to `waiting_approval` and store the plan (from the tool input) so the detail
/// panel renders it; the parked request resolves later via `approve_task` /
/// `reject_task` / `refine_task`.
fn handle_plan_gate(app: &AppHandle, store: &TaskStore, task_id: &str, event: &Value) {
    let plan = extract_plan(event);
    apply_and_emit(app, store, task_id, |task| {
        task.status = TaskStatus::WaitingApproval;
        task.plan = plan.clone();
    });
}

/// Pull the plan text out of an `ExitPlanMode` tool input. The SDK passes the plan
/// under `input.plan`; fall back to the whole input rendered as a string so the UI
/// always has something to show.
fn extract_plan(event: &Value) -> Option<String> {
    let input = event.get("input")?;
    if let Some(plan) = input.get("plan").and_then(Value::as_str) {
        return Some(plan.to_string());
    }
    Some(input.to_string())
}

/// How a run ended, for terminal bookkeeping.
enum Outcome {
    /// `session-completed`: clean up the worktree (per policy), reset the breaker.
    Succeeded,
    /// `session-failed` (genuine): retain the worktree, feed the breaker.
    Failed,
    /// `session-failed { reason: "aborted" }` (cancel / circuit-break): retain the
    /// worktree, but do NOT count toward the breaker.
    Aborted,
}

/// A run reached a terminal state: release its slot, drop the correlation binding,
/// clean up the worktree (per policy), feed the circuit breaker, and kick the
/// coordinator so the board drains without waiting a full interval.
fn finish_run(app: &AppHandle, task_id: &str, session_id: Option<u64>, outcome: Outcome) {
    let orch = app.state::<Orchestrator>();
    orch.slots.release(task_id);
    // Any permission request still parked for this run is moot: the session has
    // reached a terminal state and the engine's own teardown denies its SDK control
    // request. Drop our registry entries so they can't leak across reruns.
    let _ = orch.permissions.drain_task(task_id);
    if let Some(sid) = session_id {
        orch.provider.forget(sid);
    }
    coordinator::cleanup_worktree(app, task_id, matches!(outcome, Outcome::Succeeded));
    match outcome {
        Outcome::Succeeded => orch.breaker.record_success(),
        Outcome::Aborted => {} // user/loop cancellation: not a failure signal
        Outcome::Failed => {
            if orch.breaker.record_failure() {
                // This failure tripped the breaker: interrupt the rest and pause.
                orch.emit_state(app, "paused", Some("circuit-breaker"));
                let app = app.clone();
                tokio::spawn(async move {
                    app.state::<Orchestrator>().interrupt_all().await;
                });
            }
        }
    }
    orch.kick();
}

/// Mutate a task, persist, and emit `nc:task`.
fn apply_and_emit<F>(app: &AppHandle, store: &TaskStore, id: &str, f: F)
where
    F: FnOnce(&mut Task),
{
    match store.mutate(id, f) {
        Ok(task) => {
            let _ = app.emit(TASK_EVENT, &task);
        }
        Err(e) => eprintln!("failed to finalize task {id}: {e}"),
    }
}

// --- Commands ---------------------------------------------------------------

/// Run a task through the sidecar — the manual single-run path (still useful with
/// the loop). Leases a slot (the generalization of M1's serial guard: a free slot
/// must exist at the configured concurrency), allocates a worktree, marks the task
/// `in_progress`, ensures the sidecar is up, then dispatches `start-session`.
/// Streaming and the terminal transition happen on the reader task.
#[tauri::command]
pub async fn run_task(
    app: AppHandle,
    store: State<'_, TaskStore>,
    orch: State<'_, Orchestrator>,
    id: String,
) -> Result<(), String> {
    let task = store.get(&id).ok_or_else(|| format!("no task with id {id}"))?;

    // Lease a slot. With concurrency 1 this reproduces M1's "a task is already
    // running" rejection exactly.
    if !orch.slots.try_lease(&id) {
        return Err("no free slot (max concurrency reached)".to_string());
    }

    let cwd = match resolve_worktree(&app, &id) {
        Ok(cwd) => cwd,
        Err(e) => {
            orch.slots.release(&id);
            return Err(e);
        }
    };

    let updated = match store.mutate(&id, |task| {
        task.status = TaskStatus::InProgress;
        task.summary = None;
        task.error = None;
    }) {
        Ok(task) => task,
        Err(e) => {
            orch.slots.release(&id);
            return Err(e);
        }
    };
    let _ = app.emit(TASK_EVENT, &updated);

    if let Err(e) = ensure_reader(&app).await {
        orch.slots.release(&id);
        return Err(e);
    }

    let permission_mode = resolve_permission_mode(&app);
    if let Err(e) = orch
        .provider
        .start_session(&id, task.prompt(), task.model.clone(), cwd, permission_mode)
        .await
    {
        orch.slots.release(&id);
        return Err(e);
    }

    Ok(())
}

/// The SDK permission mode for the next run, resolved from settings (per-project
/// override, else global) and mapped to the engine's mode. Shared by the manual
/// `run_task` path and the coordinator's auto-loop launch so both honor the mode.
pub fn resolve_permission_mode(app: &AppHandle) -> Option<String> {
    use crate::settings::SettingsStore;
    let settings = app.state::<SettingsStore>();
    let project_id = app
        .state::<ProjectStore>()
        .active()
        .map(|p| p.id);
    Some(settings.sdk_permission_mode(project_id.as_deref()))
}

/// Respond to a parked interactive permission request (M3 §B). `decision` is
/// `"allow"` or `"deny"`. An allow may carry `updated_input` to rewrite the tool
/// input (the engine echoes the original when omitted); a deny carries an optional
/// `message` returned to the model. Resolves the request in the registry and sends
/// the `approve-permission` SurfaceCommand to the sidecar. Fail-closed: an unknown
/// `decision` is treated as a deny.
#[tauri::command]
pub async fn respond_permission(
    store: State<'_, TaskStore>,
    orch: State<'_, Orchestrator>,
    task_id: String,
    request_id: String,
    decision: String,
    updated_input: Option<Value>,
    message: Option<String>,
) -> Result<(), String> {
    let session_id = orch
        .provider
        .session_for(&task_id)
        .or_else(|| store.get(&task_id).and_then(|t| t.session_id))
        .ok_or_else(|| format!("no live session for task {task_id}"))?;

    // Drop it from the parked set regardless; a stale/duplicate decision is a no-op.
    orch.permissions.resolve(&task_id, &request_id);

    let decision = match decision.as_str() {
        "allow" => PermissionDecision::Allow {
            updated_input,
        },
        _ => PermissionDecision::Deny {
            message: message.unwrap_or_else(|| "Denied by user.".to_string()),
        },
    };
    orch.provider
        .decide_permission(session_id, &request_id, decision)
        .await
}

/// Best-effort interrupt of a task's run. Aborts the slot's driver (if the loop
/// spawned one) and sends an `interrupt` for the task's session; the terminal
/// transition still arrives via the sidecar's `session-failed (aborted)` event,
/// which releases the slot.
#[tauri::command]
pub async fn cancel_task(
    store: State<'_, TaskStore>,
    orch: State<'_, Orchestrator>,
    id: String,
) -> Result<(), String> {
    // Abort the driver task (no-op if none attached) but keep the slot until the
    // terminal event so the reader's cleanup runs exactly once.
    orch.slots.abort(&id);

    // Fail-closed: deny any permission request parked for this task before the
    // interrupt, so a session waiting on an approval can't hang.
    orch.deny_parked_permissions(&id).await;

    // Prefer the live correlation binding (set the moment the run started); fall
    // back to the persisted session id from a prior run.
    let session_id = orch
        .provider
        .session_for(&id)
        .or_else(|| store.get(&id).and_then(|t| t.session_id));
    if let Some(session_id) = session_id {
        orch.provider.interrupt(session_id).await?;
    }
    Ok(())
}

/// Resolve the worktree cwd for a manual run, mirroring the coordinator's logic so
/// `run_task` and the loop isolate runs identically. `Ok(None)` = run in the
/// workspace root (no active project).
fn resolve_worktree(app: &AppHandle, task_id: &str) -> Result<Option<PathBuf>, String> {
    let projects = app.state::<ProjectStore>();
    let Some(project) = projects.active() else {
        return Ok(None);
    };
    let project_path = PathBuf::from(&project.path);
    if !worktree::is_worktree_clean(&project_path).unwrap_or(true) {
        return Err(format!(
            "base working tree at {} is dirty; commit or stash before running",
            project_path.display()
        ));
    }
    let dir = worktree::allocate(&project_path, task_id)?;
    Ok(Some(dir))
}

#[cfg(test)]
mod tests {
    use crate::m2::slots::SlotManager;

    /// The M1 serial guard, now expressed through the slot manager at max=1:
    /// `run_task` rejects with no free slot whenever one is held. (The full command
    /// needs an `AppHandle` we can't build in a unit test; the decision is purely
    /// `SlotManager::try_lease`.)
    #[test]
    fn serial_guard_is_max_one_slot() {
        let slots = SlotManager::new(1);
        assert!(slots.try_lease("task-1"), "first run claims the slot");
        assert!(
            !slots.try_lease("task-2"),
            "a second run is refused while one holds the only slot"
        );
        slots.release("task-1");
        assert!(slots.try_lease("task-2"), "freed slot admits the next run");
    }

    /// A terminal event releases the slot, letting the next run pass the guard —
    /// the M2 equivalent of M1's `set_active(None)` on completion.
    #[test]
    fn terminal_event_frees_the_slot() {
        let slots = SlotManager::new(1);
        slots.try_lease("task-1");
        assert_eq!(slots.free_slots(), 0);
        slots.release("task-1"); // finish_run does this on a terminal event
        assert_eq!(slots.free_slots(), 1);
    }
}
