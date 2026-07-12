//! The merge-bar preconditions and the gauntlet-failure messaging for the create
//! path. Pure + unit-testable without an `AppHandle`: the same bar as merge (a PR
//! is a publish, not a side door around the gates), plus the human failure copy
//! that folds a failing readiness/structure-lock step's command + exit code +
//! output tail into the dialog (feature #3).

use crate::gauntlet;
use crate::store::types::StructureLockResult;
use crate::task::Task;

/// The PR preconditions, pure so they are unit-testable without an `AppHandle`:
/// worktree run-mode (`refuse_main_mode_merge` twin — a main-mode task has no
/// branch to push), a commit on the branch, and an earned verified PASS (the
/// same bar as merge — a PR is a publish, not a side door around the gauntlet).
pub(super) fn check_pr_preconditions(task: &Task) -> Result<(), String> {
    if !task.run_mode.is_worktree() {
        return Err(
            "this task runs on main — its changes are already on the project branch; \
             there is no worktree branch to open a PR from"
                .to_string(),
        );
    }
    if !task.committed {
        return Err(
            "task has no commit on its branch — commit it before creating a PR".to_string(),
        );
    }
    if !task.verified {
        return Err(
            "task is not verified — a reviewer must pass it (or accept the review) \
             before creating a PR"
                .to_string(),
        );
    }
    if task.merged {
        return Err("task is already merged — nothing to publish".to_string());
    }
    if task.pr_url.is_some() {
        return Err("a PR already exists for this task".to_string());
    }
    Ok(())
}

/// Append the failing gauntlet step's exact command, exit code, and a tail of its
/// output to a failure header, so the create-PR dialog explains *why* the gate
/// failed — not just which step (feature #3). Empty when no detail is available
/// (e.g. a step that never captured output). Pure + reused by both gauntlet gates.
fn step_failure_detail(command: &str, exit_code: Option<i32>, output: Option<&str>) -> String {
    let mut detail = format!("\n\n$ {command}");
    if let Some(code) = exit_code {
        detail.push_str(&format!("  (exit {code})"));
    }
    if let Some(out) = output {
        let out = out.trim();
        if !out.is_empty() {
            detail.push('\n');
            detail.push_str(out);
        }
    }
    detail
}

/// The create-PR error for a failed READINESS gauntlet: name the failing step and
/// fold in its command + exit code + output tail (feature #3). Pure so the payload
/// shape is unit-testable without a real worktree.
pub(super) fn readiness_failure_message(result: &gauntlet::GauntletResult) -> String {
    let failed = result.failed_step.as_deref().unwrap_or("unknown");
    let detail = result
        .steps
        .iter()
        .find(|s| s.name == failed)
        .map(|s| step_failure_detail(&s.command, s.exit_code, s.output.as_deref()))
        .unwrap_or_default();
    format!("readiness gauntlet failed at `{failed}` — fix the checks before creating a PR{detail}")
}

/// The create-PR error for a failed STRUCTURE-LOCK gauntlet: the harness twin of
/// [`readiness_failure_message`], folding in the failing check's command + exit
/// code + output tail. Pure + unit-testable.
pub(super) fn structure_lock_failure_message(lock: &StructureLockResult) -> String {
    let failed = lock.failed_check.as_deref().unwrap_or("unknown");
    let detail = lock
        .checks
        .iter()
        .find(|c| c.name == failed)
        .map(|c| step_failure_detail(&c.command, c.exit_code, c.output.as_deref()))
        .unwrap_or_default();
    format!(
        "structure-lock gauntlet failed at `{failed}` — fix the harness checks before creating a PR{detail}"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gauntlet::{GauntletResult, GauntletStep};
    use crate::store::types::{StepStatus, StructureLockCheck};
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
    fn preconditions_refuse_main_mode_uncommitted_and_unverified() {
        // Main mode: no branch to push (the refuse_main_mode_merge twin).
        let main_task = Task::new("edit on main".into(), String::new());
        let err = check_pr_preconditions(&main_task).expect_err("main mode is refused");
        assert!(err.contains("runs on main"), "explains the refusal: {err}");

        // Worktree but uncommitted: nothing on the branch to publish.
        let mut uncommitted =
            Task::new("wip".into(), String::new()).with_run_mode(RunMode::Worktree);
        uncommitted.verified = true;
        let err = check_pr_preconditions(&uncommitted).expect_err("uncommitted is refused");
        assert!(err.contains("commit"), "points at commit: {err}");

        // Worktree + committed but unverified: the same bar as merge.
        let mut unverified =
            Task::new("wip".into(), String::new()).with_run_mode(RunMode::Worktree);
        unverified.committed = true;
        let err = check_pr_preconditions(&unverified).expect_err("unverified is refused");
        assert!(err.contains("not verified"), "names the gate: {err}");

        // All three bars cleared ⇒ pass.
        assert!(check_pr_preconditions(&ready_task()).is_ok());
    }

    #[test]
    fn preconditions_refuse_merged_and_already_published_tasks() {
        // A merged task has nothing left to publish.
        let mut merged = ready_task();
        merged.merged = true;
        let err = check_pr_preconditions(&merged).expect_err("merged is refused");
        assert!(
            err.contains("already merged"),
            "explains the refusal: {err}"
        );

        // A task that already carries a PR must not create a second one.
        let mut published = ready_task();
        published.pr_url = Some("https://github.com/acme/widget/pull/7".into());
        let err = check_pr_preconditions(&published).expect_err("existing PR is refused");
        assert!(
            err.contains("already exists"),
            "explains the refusal: {err}"
        );
    }

    #[test]
    fn readiness_failure_message_carries_the_failing_step_command_and_output() {
        // The empirical PR-blocker: a `typecheck` that exits 2. The dialog must
        // show the command + exit code + output tail (feature #3), not just the name.
        let result = GauntletResult {
            passed: false,
            failed_step: Some("typecheck".to_string()),
            steps: vec![
                GauntletStep {
                    name: "typecheck".to_string(),
                    command: "bun run typecheck".to_string(),
                    status: StepStatus::Failed,
                    exit_code: Some(2),
                    output: Some(
                        "src/x.ts(5,8): error TS2307: Cannot find module 'zod'".to_string(),
                    ),
                },
                GauntletStep {
                    name: "lint".to_string(),
                    command: "bun run lint".to_string(),
                    status: StepStatus::Skipped,
                    exit_code: None,
                    output: None,
                },
            ],
        };
        let msg = readiness_failure_message(&result);
        assert!(
            msg.contains("readiness gauntlet failed at `typecheck`"),
            "names the step: {msg}"
        );
        assert!(
            msg.contains("bun run typecheck"),
            "carries the command: {msg}"
        );
        assert!(msg.contains("exit 2"), "carries the exit code: {msg}");
        assert!(
            msg.contains("Cannot find module 'zod'"),
            "carries the output tail: {msg}"
        );
    }

    #[test]
    fn structure_lock_failure_message_carries_the_failing_check_command_and_output() {
        let lock = StructureLockResult {
            passed: false,
            failed_check: Some("folder-per-component".to_string()),
            checks: vec![StructureLockCheck {
                name: "folder-per-component".to_string(),
                kind: "lint-plugin".to_string(),
                command: "bun run lint:harness".to_string(),
                status: StepStatus::Failed,
                exit_code: Some(1),
                output: Some("Component must live in its own folder".to_string()),
                duration_ms: None,
            }],
        };
        let msg = structure_lock_failure_message(&lock);
        assert!(
            msg.contains("structure-lock gauntlet failed at `folder-per-component`"),
            "names the check: {msg}"
        );
        assert!(
            msg.contains("bun run lint:harness"),
            "carries the command: {msg}"
        );
        assert!(msg.contains("exit 1"), "carries the exit code: {msg}");
        assert!(
            msg.contains("must live in its own folder"),
            "carries the output tail: {msg}"
        );
    }

    #[test]
    fn failure_message_falls_back_to_the_header_when_no_step_detail_is_present() {
        // An empty steps list (or a `failed_step` absent from `steps`) still yields
        // the human header — never a panic or an empty string.
        let result = GauntletResult {
            passed: false,
            steps: Vec::new(),
            failed_step: None,
        };
        let msg = readiness_failure_message(&result);
        assert!(
            msg.contains("readiness gauntlet failed at `unknown`"),
            "graceful header: {msg}"
        );
        assert!(
            !msg.contains("$ "),
            "no command block when there is no detail: {msg}"
        );
    }
}
