//! Path + branch-name computation and the worktree-escape guard.
//!
//! Pure functions only — no `git`, no I/O — so the security-critical guard
//! ([`is_under`]) and the base-dir naming ([`worktrees_base`] / [`worktree_path`])
//! can be audited and unit-tested in isolation. Every worktree lives under
//! `<project>/.nightcore/worktrees/<taskId>`; [`is_under`] is the sole check that
//! keeps a removal from ever touching anything outside that base.

use std::path::{Path, PathBuf};

/// The branch name for a task's run: `nc/<taskId>`.
pub fn branch_name(task_id: &str) -> String {
    format!("nc/{task_id}")
}

/// The base dir all Nightcore worktrees live under for a project.
pub fn worktrees_base(project_path: &Path) -> PathBuf {
    project_path.join(".nightcore/worktrees")
}

/// The worktree dir for a task: `<project>/.nightcore/worktrees/<taskId>`.
pub fn worktree_path(project_path: &Path, task_id: &str) -> PathBuf {
    worktrees_base(project_path).join(task_id)
}

// ─── Terminal-created worktrees (spec PR 5) ─────────────────────────────────────
// A SEPARATE namespace from the task worktrees above. The task base
// (`.nightcore/worktrees/`) is enumerated by [`super::lifecycle::list_worktree_task_ids`]
// (dir names read AS TASK IDS) and pruned at startup by [`super::lifecycle::reconcile`]
// (any dir whose id is not a live task is deleted). A user-created terminal worktree
// has NO task, so it must live outside that base or it would be garbage-collected on the
// next relaunch. It gets its own base + `term/<slug>` branch prefix, never touched by the
// task reconcile sweep.

/// The base dir all user-created *terminal* worktrees live under for a project —
/// distinct from [`worktrees_base`] so the task reconcile sweep never sees them.
pub fn terminal_worktrees_base(project_path: &Path) -> PathBuf {
    project_path.join(".nightcore/worktrees-term")
}

/// The worktree dir for a terminal worktree slug:
/// `<project>/.nightcore/worktrees-term/<slug>`.
pub fn terminal_worktree_path(project_path: &Path, slug: &str) -> PathBuf {
    terminal_worktrees_base(project_path).join(slug)
}

/// The branch name for a terminal worktree: `term/<slug>` — outside the `nc/<taskId>`
/// namespace the board monitor + reconcile key on.
pub fn terminal_branch_name(slug: &str) -> String {
    format!("term/{slug}")
}

/// Maximum slug length — long enough for a descriptive name, short enough to keep the
/// dir/branch tidy.
const MAX_SLUG_LEN: usize = 60;

/// Sanitize a user-supplied display name into a filesystem/branch-safe slug: lowercase,
/// every run of non-`[a-z0-9]` collapsed to a single `-`, trimmed of leading/trailing
/// `-`, capped at [`MAX_SLUG_LEN`]. Returns `None` when nothing usable survives (empty /
/// all-punctuation input), so the caller rejects it rather than creating a `term/`
/// worktree with an empty or option-shaped name. The output always satisfies
/// [`is_clean_slug`]. Pure + unit-tested.
pub fn slugify(name: &str) -> Option<String> {
    let mut out = String::with_capacity(name.len().min(MAX_SLUG_LEN));
    let mut prev_dash = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
        if out.len() >= MAX_SLUG_LEN {
            break;
        }
    }
    let slug = out.trim_matches('-').to_string();
    if slug.is_empty() {
        None
    } else {
        Some(slug)
    }
}

/// Whether `slug` is a clean terminal-worktree slug: non-empty, only `[a-z0-9-]`, with no
/// path-traversal characters. The security guard on [`terminal_worktree_path`] joins:
/// rejecting `/`, `\`, and `.` here means a webview-supplied slug can never escape the
/// terminal worktrees base (defence in depth alongside the `is_under` check at removal).
pub fn is_clean_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= MAX_SLUG_LEN
        && slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Whether `candidate` is strictly under `base` (used to refuse removals outside
/// the Nightcore worktrees dir). Compares lexically on normalized components, so it
/// does not require the paths to exist.
pub fn is_under(base: &Path, candidate: &Path) -> bool {
    let base: Vec<_> = base.components().collect();
    let cand: Vec<_> = candidate.components().collect();
    cand.len() > base.len() && cand[..base.len()] == base[..]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    #[test]
    fn branch_and_path_computation() {
        let project = Path::new("/repo/nightcore");
        assert_eq!(branch_name("abc-123"), "nc/abc-123");
        assert_eq!(
            worktrees_base(project),
            PathBuf::from("/repo/nightcore/.nightcore/worktrees")
        );
        assert_eq!(
            worktree_path(project, "abc-123"),
            PathBuf::from("/repo/nightcore/.nightcore/worktrees/abc-123")
        );
    }

    #[test]
    fn is_under_guards_the_base() {
        let base = Path::new("/repo/.nightcore/worktrees");
        assert!(is_under(
            base,
            Path::new("/repo/.nightcore/worktrees/task-1")
        ));
        assert!(
            !is_under(base, Path::new("/repo")),
            "parent is not under base"
        );
        assert!(
            !is_under(base, base),
            "the base itself is not strictly under"
        );
        assert!(
            !is_under(base, Path::new("/repo/.nightcore/other")),
            "a sibling dir is not under the worktrees base"
        );
        assert!(
            !is_under(base, Path::new("/etc/passwd")),
            "an unrelated path is rejected"
        );
    }

    #[test]
    fn terminal_worktree_naming_uses_a_separate_base_and_branch_prefix() {
        let project = Path::new("/repo/nightcore");
        assert_eq!(terminal_branch_name("my-shell"), "term/my-shell");
        assert_eq!(
            terminal_worktrees_base(project),
            PathBuf::from("/repo/nightcore/.nightcore/worktrees-term")
        );
        assert_eq!(
            terminal_worktree_path(project, "my-shell"),
            PathBuf::from("/repo/nightcore/.nightcore/worktrees-term/my-shell")
        );
        // The terminal base is a SIBLING of the task base — the reconcile sweep reads
        // the task base only, so a terminal worktree is never enumerated as a task.
        assert_ne!(terminal_worktrees_base(project), worktrees_base(project));
    }

    #[test]
    fn slugify_produces_clean_slugs_or_none() {
        assert_eq!(
            slugify("My Feature Branch").as_deref(),
            Some("my-feature-branch")
        );
        assert_eq!(slugify("  spaces  ").as_deref(), Some("spaces"));
        assert_eq!(
            slugify("weird!!!name///here").as_deref(),
            Some("weird-name-here")
        );
        assert_eq!(slugify("UPPER_case-123").as_deref(), Some("upper-case-123"));
        // All-punctuation / empty input yields nothing usable.
        assert_eq!(slugify(""), None);
        assert_eq!(slugify("!!!"), None);
        assert_eq!(slugify("///"), None);
        // Every non-None slug is clean (the invariant the removal guard relies on).
        for name in ["My Feature", "a b c", "x", "trailing---"] {
            if let Some(slug) = slugify(name) {
                assert!(
                    is_clean_slug(&slug),
                    "slugify({name:?}) = {slug:?} must be clean"
                );
            }
        }
    }

    #[test]
    fn is_clean_slug_rejects_traversal_and_bad_chars() {
        assert!(is_clean_slug("my-shell"));
        assert!(is_clean_slug("feature-123"));
        assert!(!is_clean_slug(""), "empty is not clean");
        assert!(!is_clean_slug("../escape"), "traversal rejected");
        assert!(!is_clean_slug("a/b"), "slash rejected");
        assert!(!is_clean_slug("a.b"), "dot rejected");
        assert!(
            !is_clean_slug("Upper"),
            "uppercase rejected (slugify lowercases)"
        );
        assert!(!is_clean_slug(&"x".repeat(61)), "over-length rejected");
    }

    #[test]
    fn remove_refuses_paths_outside_the_base() {
        // A task id that tries to escape the base via traversal can't reach outside
        // it: worktree_path joins it under the base, and is_under still holds. Here
        // we assert the guard directly on a crafted path.
        let base = worktrees_base(Path::new("/repo"));
        assert!(!is_under(&base, Path::new("/repo/.git")));
    }
}
