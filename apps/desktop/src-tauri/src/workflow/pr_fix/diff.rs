//! The pr-fix commit DIFF bridge: what a fix session actually changed, shown at
//! the push gate so the human approves the REAL diff rather than the model's
//! prose summary (T10 governed-autonomy gap). Reuses the worktree diff seam
//! ([`worktree::worktree_diff`] / [`worktree::file_diff`]) against a resolved
//! base commit — the remote head of the PR branch when it is known (so the view
//! is exactly the unpushed delta the push will publish), else the fix commit's
//! parent (`HEAD~1`, always present for a fix commit).

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::git::run::git;
use crate::worktree::{self, WorktreeDiff};

use super::state::PrFixRegistry;

/// Resolve the base the fix diff is shown against, as a resolved SHA (so it
/// splices safely and passes [`worktree::file_diff`]'s `validate_ref`). Prefer
/// the remote head of the PR branch — `refs/remotes/origin/<branch>` — so the
/// diff is exactly the unpushed delta a push would publish (it captures every
/// local commit ahead of the remote, not just the last one). Fall back to the
/// fix commit's parent (`HEAD~1`) when there is no remote-tracking ref (e.g. a
/// brand-new branch). `branch` is `validate_ref`-ed before it is spliced, and
/// both revisions are `--end-of-options`-fenced (defence in depth).
fn resolve_fix_diff_base(dir: &Path, branch: &str) -> Result<String, String> {
    if crate::git::validate_ref(branch).is_ok() {
        let remote_ref = format!("refs/remotes/origin/{branch}");
        if let Ok(sha) = git(
            dir,
            &[
                "rev-parse",
                "--verify",
                "--quiet",
                "--end-of-options",
                &remote_ref,
            ],
        ) {
            if !sha.is_empty() {
                return Ok(sha);
            }
        }
    }
    let parent = git(
        dir,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            "--end-of-options",
            "HEAD~1",
        ],
    )
    .map_err(|e| format!("could not resolve the fix commit's parent to diff against: {e}"))?;
    if parent.is_empty() {
        return Err("the fix commit has no parent to diff against".to_string());
    }
    Ok(parent)
}

/// Look up a fix's checkout dir + branch, or the not-found error the caller
/// surfaces. Shared by both diff commands.
fn fix_checkout(app: &AppHandle, fix_id: &str) -> Result<(PathBuf, String), String> {
    let state = app
        .try_state::<PrFixRegistry>()
        .ok_or_else(|| "pr-fix registry unavailable".to_string())?
        .get(fix_id)
        .ok_or_else(|| format!("no PR fix with id {fix_id}"))?;
    Ok((PathBuf::from(&state.dir), state.branch))
}

/// The fix commit's changed-file list vs its resolved base — the push gate's
/// trust view (the human approves the real diff, not the model's prose). Pure
/// local git; safe on the blocking pool.
#[tauri::command]
pub async fn pr_fix_diff(app: AppHandle, fix_id: String) -> Result<WorktreeDiff, String> {
    let (dir, branch) = fix_checkout(&app, &fix_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let base = resolve_fix_diff_base(&dir, &branch)?;
        Ok(worktree::worktree_diff(&dir, &base))
    })
    .await
    .map_err(|e| format!("computing the fix diff failed to run: {e}"))?
}

/// The unified-diff patch for ONE file of the fix commit vs its resolved base —
/// the per-file payload the push gate's viewer renders. Reuses the confined,
/// symlink-guarded [`worktree::file_diff`]. Pure local git; blocking-pool work.
#[tauri::command]
pub async fn pr_fix_file_diff(
    app: AppHandle,
    fix_id: String,
    path: String,
) -> Result<String, String> {
    let (dir, branch) = fix_checkout(&app, &fix_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let base = resolve_fix_diff_base(&dir, &branch)?;
        worktree::file_diff(&dir, &base, &path)
    })
    .await
    .map_err(|e| format!("computing the fix file diff failed to run: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::testutil::{git_expect, git_stdout};

    /// Build a repo with two commits so `HEAD~1` resolves to the first.
    fn repo_with_two_commits() -> Option<tempfile::TempDir> {
        let tmp = tempfile::TempDir::new().ok()?;
        let dir = tmp.path();
        git_expect(dir, &["init", "-q", "-b", "main"]);
        std::fs::write(dir.join("a.txt"), "one\n").ok()?;
        git_expect(dir, &["add", "-A"]);
        git_expect(dir, &["commit", "-q", "-m", "first"]);
        std::fs::write(dir.join("a.txt"), "one\ntwo\n").ok()?;
        git_expect(dir, &["add", "-A"]);
        git_expect(dir, &["commit", "-q", "-m", "second"]);
        Some(tmp)
    }

    #[test]
    fn base_falls_back_to_the_fix_commits_parent_when_no_remote_ref() {
        let Some(tmp) = repo_with_two_commits() else {
            return;
        };
        let dir = tmp.path();
        // No `origin/<branch>` remote-tracking ref exists → parent fallback.
        let base = resolve_fix_diff_base(dir, "main").expect("base resolves");
        let parent = git_stdout(dir, &["rev-parse", "HEAD~1"]);
        assert_eq!(base, parent, "base is the fix commit's parent SHA");
        // And that base yields the second commit's change as the diff.
        let diff = worktree::worktree_diff(dir, &base);
        assert!(
            diff.files.iter().any(|f| f.path == "a.txt"),
            "the fix commit's changed file is in the diff: {diff:?}"
        );
    }

    #[test]
    fn base_prefers_the_remote_head_when_it_exists() {
        let Some(tmp) = repo_with_two_commits() else {
            return;
        };
        let dir = tmp.path();
        // Fabricate a remote-tracking ref at the FIRST commit (as a fetch would
        // leave it): the resolved base must be that ref, not `HEAD~1` (here they
        // coincide, so assert the ref path resolves and returns a real SHA).
        let first = git_stdout(dir, &["rev-parse", "HEAD~1"]);
        git_expect(dir, &["update-ref", "refs/remotes/origin/main", &first]);
        let base = resolve_fix_diff_base(dir, "main").expect("base resolves");
        assert_eq!(base, first, "base is the remote-tracking head SHA");
    }

    #[test]
    fn missing_fix_is_a_clean_error() {
        // No registry managed in a bare AppHandle-less unit context: exercise the
        // base resolver's parentless-commit guard instead (a single-commit repo).
        let Some(tmp) = tempfile::TempDir::new().ok() else {
            return;
        };
        let dir = tmp.path();
        git_expect(dir, &["init", "-q", "-b", "main"]);
        std::fs::write(dir.join("a.txt"), "one\n").expect("write");
        git_expect(dir, &["add", "-A"]);
        git_expect(dir, &["commit", "-q", "-m", "only"]);
        let err = resolve_fix_diff_base(dir, "main").unwrap_err();
        assert!(
            err.contains("no parent") || err.contains("parent"),
            "a root commit has no parent to diff against: {err}"
        );
    }
}
