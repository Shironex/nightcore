//! Branch/base resolution for a PR: pick the pair exactly like merge does (task
//! branch → `nc/<id>`; explicit base arg → task base → project current branch),
//! then validate BOTH through `validate_ref` before either reaches an argv (refs
//! are git's injection surface). Pure.

use crate::git::validate_ref;
use crate::task::Task;
use crate::worktree;

/// Resolve the branch/base pair for a PR, exactly like merge does (task branch →
/// `nc/<id>`; explicit base arg → task base → project current branch), then
/// validate BOTH through `validate_ref` before either reaches an argv. Pure.
pub(super) fn resolve_branch_and_base(
    task: &Task,
    id: &str,
    base_arg: Option<String>,
    project_base: impl FnOnce() -> String,
) -> Result<(String, String), String> {
    let branch = task
        .branch
        .clone()
        .unwrap_or_else(|| worktree::branch_name(id));
    let base = base_arg
        .or_else(|| task.base_branch.clone())
        .unwrap_or_else(project_base);
    validate_ref(&branch)?;
    validate_ref(&base)?;
    Ok((branch, base))
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
    fn resolve_branch_and_base_defaults_then_validates() {
        // Defaults: nc/<id> + the project's current branch.
        let task = ready_task();
        let (branch, base) =
            resolve_branch_and_base(&task, "t-1", None, || "main".to_string()).expect("resolve");
        assert_eq!(branch, "nc/t-1");
        assert_eq!(base, "main");

        // The task's stored branch/base win over the defaults…
        let mut chosen = ready_task();
        chosen.branch = Some("feature/login".into());
        chosen.base_branch = Some("develop".into());
        let (branch, base) =
            resolve_branch_and_base(&chosen, "t-1", None, || "main".to_string()).expect("resolve");
        assert_eq!(branch, "feature/login");
        assert_eq!(base, "develop");

        // …and an explicit base argument beats the task's stored base.
        let (_, base) = resolve_branch_and_base(&chosen, "t-1", Some("release/2.0".into()), || {
            "main".to_string()
        })
        .expect("resolve");
        assert_eq!(base, "release/2.0");

        // Option-injection refs are rejected on BOTH axes (validate_ref).
        let mut hostile = ready_task();
        hostile.branch = Some("-D".into());
        assert!(
            resolve_branch_and_base(&hostile, "t-1", None, || "main".to_string()).is_err(),
            "a dash branch is rejected"
        );
        let err = resolve_branch_and_base(&ready_task(), "t-1", Some("--force".into()), || {
            "main".to_string()
        })
        .expect_err("a dash base is rejected");
        assert!(err.contains("invalid branch/base name"), "err: {err}");
    }
}
