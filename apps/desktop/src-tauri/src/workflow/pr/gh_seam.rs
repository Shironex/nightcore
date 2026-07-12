//! The `gh pr create` seam and its `gh pr view` idempotency recovery.
//!
//! The binary is injected as a parameter (the `secret_scan::scan_staged_with`
//! template) so the tests exercise the real spawn + stdin + exit-code mapping
//! with a fake `gh` script. Every ref is re-validated before it reaches an argv,
//! the PR body travels on **stdin** (`--body-file -`), and a create failure is
//! recovered through `gh pr view` when an OPEN PR already exists for the branch.

use std::path::Path;

use super::parse::{parse_pr_url, parse_pr_view};
use crate::git::gh::{map_gh_failure, run_gh_bounded};
use crate::git::validate_ref;

/// Wall-clock bound on every network-facing `gh` spawn (create + view). Same
/// rationale as the push deadline: generous, but finite — a black-holed GitHub
/// must error out, not pin the blocking thread + PR lease with the dialog stuck
/// on "Creating…".
const GH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

/// The outcome of a `gh pr create` attempt. `ToolAbsent` is distinct from
/// `Failed` (the `secret_scan::ScanOutcome` precedent) so the caller can say
/// "install gh" rather than surface a spawn error.
pub(super) enum PrCreateOutcome {
    /// The PR was created; the URL parsed from gh's stdout + the derived number.
    Created { url: String, number: u64 },
    /// The gh binary is not on PATH (the pre-spawn `which` probe — the ONLY
    /// ToolAbsent source; a spawn-time NotFound after a green probe is a
    /// vanished cwd and maps to `Failed`).
    ToolAbsent,
    /// gh exited non-zero (its stderr, verbatim) or its output was unusable.
    Failed { message: String },
}

/// Create the PR via `gh pr create`, with the binary as a parameter — the
/// injection seam the tests use to exercise the real spawn path with a fake
/// script (the `secret_scan::scan_staged_with` template). The body travels on
/// **stdin** (`--body-file -`), never argv.
fn create_pr_with(
    dir: &Path,
    binary: &str,
    branch: &str,
    base: &str,
    title: &str,
    body: &str,
    draft: bool,
) -> PrCreateOutcome {
    // Defence in depth: the caller already validated both refs, but this seam is
    // callable on its own, so re-check before splicing them into an argv.
    if let Err(e) = validate_ref(branch).and_then(|_| validate_ref(base)) {
        return PrCreateOutcome::Failed { message: e };
    }
    // Probe with `which` (PATHEXT-aware) instead of relying on a NotFound spawn
    // error — on Windows the platform resolver falls back to `cmd /C <name>`,
    // whose spawn SUCCEEDS then exits non-zero, which would misread "gh not
    // installed" as a create failure (the gitleaks-gate rationale).
    if which::which(binary).is_err() {
        return PrCreateOutcome::ToolAbsent;
    }

    let mut args = vec![
        "pr",
        "create",
        "--head",
        branch,
        "--base",
        base,
        "--title",
        title,
        "--body-file",
        "-",
    ];
    if draft {
        args.push("--draft");
    }
    let out = match run_gh_bounded(
        dir,
        binary,
        &args,
        Some(body),
        GH_TIMEOUT,
        "timed out creating the pull request on GitHub — check your network and try again",
    ) {
        Ok(out) => out,
        Err(message) => return PrCreateOutcome::Failed { message },
    };
    if !out.status.success() {
        return PrCreateOutcome::Failed {
            message: map_gh_failure(binary, "pr create", &out),
        };
    }
    match parse_pr_url(&out.stdout) {
        Some((url, number)) => PrCreateOutcome::Created { url, number },
        None => PrCreateOutcome::Failed {
            message: format!(
                "`{binary} pr create` succeeded but its output carried no PR URL — \
                 check the PR on GitHub; output was: {}",
                out.stdout.trim()
            ),
        },
    }
}

/// Create the PR, and on a create failure attempt RECOVERY through `gh pr view`:
/// if an OPEN PR for `branch` already exists, report it as `Created` instead of
/// surfacing the error. This is the idempotency net for two half-done shapes —
/// a create that succeeded on GitHub but died before Nightcore persisted the
/// URL, and a zero-exit create whose output carried no parseable URL — which
/// would otherwise fail every retry forever on "a pull request already exists".
/// `ToolAbsent` is never recovered (no gh ⇒ no view either).
pub(super) fn create_or_recover_with(
    dir: &Path,
    binary: &str,
    branch: &str,
    base: &str,
    title: &str,
    body: &str,
    draft: bool,
) -> PrCreateOutcome {
    match create_pr_with(dir, binary, branch, base, title, body, draft) {
        PrCreateOutcome::Failed { message } => match view_pr_with(dir, binary, branch) {
            Some((url, number)) => {
                tracing::info!(
                    target: "nightcore::pr",
                    branch = %branch,
                    pr_number = number,
                    "create failed but an open PR already exists for the branch — recovered"
                );
                PrCreateOutcome::Created { url, number }
            }
            None => PrCreateOutcome::Failed { message },
        },
        outcome => outcome,
    }
}

/// Look up the existing OPEN PR for `branch` via `gh pr view <branch> --json
/// url,number,state` in the worktree dir (the same bounded-spawn seam as
/// create). Best-effort by design: any failure — non-zero exit (no PR), a
/// timeout, unparseable JSON, a non-open PR — yields `None`, and the caller
/// surfaces the ORIGINAL create error instead.
fn view_pr_with(dir: &Path, binary: &str, branch: &str) -> Option<(String, u64)> {
    validate_ref(branch).ok()?;
    let out = run_gh_bounded(
        dir,
        binary,
        &["pr", "view", branch, "--json", "url,number,state"],
        None,
        GH_TIMEOUT,
        "timed out looking up the pull request on GitHub",
    )
    .ok()?;
    if !out.status.success() {
        return None;
    }
    parse_pr_view(&out.stdout)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// Write an executable shell script into `dir` to stand in for `gh`, so the
    /// tests exercise the real spawn + stdin + exit-code mapping (not a mock) —
    /// the `secret_scan` fixture pattern.
    #[cfg(unix)]
    fn fake_gh(dir: &Path, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join("fake-gh.sh");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("write script");
        let mut perms = std::fs::metadata(&path)
            .expect("script metadata")
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&path, perms).expect("chmod script");
        path
    }

    #[test]
    #[cfg(unix)]
    fn create_pr_with_success_parses_url_and_feeds_body_on_stdin() {
        let tmp = tempfile::TempDir::new().expect("temp dir");
        // The fake gh records its argv and its stdin, then prints the URL line.
        let script = fake_gh(
            tmp.path(),
            "printf '%s\\n' \"$@\" > args.txt\ncat > body.txt\n\
             echo 'Creating pull request for nc/t-1 into main'\n\
             echo 'https://github.com/acme/widget/pull/42'",
        );
        let outcome = create_pr_with(
            tmp.path(),
            script.to_str().expect("utf8 path"),
            "nc/t-1",
            "main",
            "feat: add login",
            "## Summary\nbody text",
            true,
        );
        let PrCreateOutcome::Created { url, number } = outcome else {
            panic!("expected Created");
        };
        assert_eq!(url, "https://github.com/acme/widget/pull/42");
        assert_eq!(number, 42);

        // The body arrived on stdin, never argv.
        let body = std::fs::read_to_string(tmp.path().join("body.txt")).expect("body.txt");
        assert_eq!(body, "## Summary\nbody text");
        let args = std::fs::read_to_string(tmp.path().join("args.txt")).expect("args.txt");
        let args: Vec<&str> = args.lines().collect();
        assert!(
            !args.iter().any(|a| a.contains("Summary")),
            "the body must not appear in argv: {args:?}"
        );
        // The argv carries the contract flags: head/base/title, body from stdin,
        // and --draft when requested.
        for expected in [
            "pr",
            "create",
            "--head",
            "nc/t-1",
            "--base",
            "main",
            "--title",
            "feat: add login",
            "--body-file",
            "-",
            "--draft",
        ] {
            assert!(
                args.contains(&expected),
                "argv missing {expected}: {args:?}"
            );
        }
    }

    #[test]
    #[cfg(unix)]
    fn create_pr_with_omits_draft_flag_when_not_draft() {
        let tmp = tempfile::TempDir::new().expect("temp dir");
        let script = fake_gh(
            tmp.path(),
            "printf '%s\\n' \"$@\" > args.txt\ncat > /dev/null\n\
             echo 'https://github.com/acme/widget/pull/1'",
        );
        let outcome = create_pr_with(
            tmp.path(),
            script.to_str().expect("utf8 path"),
            "nc/t-1",
            "main",
            "t",
            "b",
            false,
        );
        assert!(matches!(outcome, PrCreateOutcome::Created { .. }));
        let args = std::fs::read_to_string(tmp.path().join("args.txt")).expect("args.txt");
        assert!(
            !args.lines().any(|a| a == "--draft"),
            "no --draft when draft=false: {args}"
        );
    }

    #[test]
    #[cfg(unix)]
    fn create_pr_with_surfaces_stderr_verbatim_on_failure() {
        let tmp = tempfile::TempDir::new().expect("temp dir");
        let script = fake_gh(
            tmp.path(),
            "cat > /dev/null\n\
             echo 'a pull request for branch \"nc/t-1\" into branch \"main\" already exists' >&2\n\
             exit 1",
        );
        let outcome = create_pr_with(
            tmp.path(),
            script.to_str().expect("utf8 path"),
            "nc/t-1",
            "main",
            "t",
            "b",
            false,
        );
        let PrCreateOutcome::Failed { message } = outcome else {
            panic!("a non-zero exit must map to Failed");
        };
        assert!(
            message.contains("already exists"),
            "gh's stderr is verbatim: {message}"
        );
    }

    #[test]
    #[cfg(unix)]
    fn create_pr_with_zero_exit_but_no_url_is_a_loud_failure() {
        let tmp = tempfile::TempDir::new().expect("temp dir");
        let script = fake_gh(tmp.path(), "cat > /dev/null\necho 'no url here'");
        let outcome = create_pr_with(
            tmp.path(),
            script.to_str().expect("utf8 path"),
            "nc/t-1",
            "main",
            "t",
            "b",
            false,
        );
        let PrCreateOutcome::Failed { message } = outcome else {
            panic!("a URL-less success must map to Failed");
        };
        assert!(message.contains("no PR URL"), "{message}");
    }

    #[test]
    #[cfg(unix)]
    fn create_pr_with_vanished_cwd_is_a_launch_failure_not_tool_absent() {
        // The binary EXISTS (which succeeds) but the worktree dir is gone by
        // spawn time — the racing-merge-cleanup shape. That spawn NotFound must
        // NOT read as "gh is not installed"; it is a launch failure naming the
        // cwd so the user looks at the worktree, not their gh install.
        let tmp = tempfile::TempDir::new().expect("temp dir");
        let script = fake_gh(tmp.path(), "echo 'https://github.com/acme/widget/pull/1'");
        let gone = tmp.path().join("deleted-worktree");
        let outcome = create_pr_with(
            &gone,
            script.to_str().expect("utf8 path"),
            "nc/t-1",
            "main",
            "t",
            "b",
            false,
        );
        let PrCreateOutcome::Failed { message } = outcome else {
            panic!("a vanished cwd must map to Failed, not ToolAbsent");
        };
        assert!(
            message.contains("deleted-worktree"),
            "the failure names the cwd: {message}"
        );
        assert!(
            message.contains("worktree may have been removed"),
            "the failure explains the likely cause: {message}"
        );
    }

    #[test]
    fn create_pr_with_absent_binary_is_tool_absent_not_failed() {
        let tmp = tempfile::TempDir::new().expect("temp dir");
        let outcome = create_pr_with(
            tmp.path(),
            "definitely-not-a-real-binary-xyz",
            "nc/t-1",
            "main",
            "t",
            "b",
            false,
        );
        assert!(
            matches!(outcome, PrCreateOutcome::ToolAbsent),
            "a missing gh is ToolAbsent (install-to-arm, the gitleaks contract)"
        );
    }

    #[test]
    fn create_pr_with_rejects_injection_refs_before_any_spawn() {
        let tmp = tempfile::TempDir::new().expect("temp dir");
        // The binary doesn't exist — but validation runs FIRST, so the outcome is
        // the validation Failure, not ToolAbsent: proof no probe/spawn happened.
        for (branch, base) in [("-D", "main"), ("nc/t-1", "--force")] {
            let outcome = create_pr_with(
                tmp.path(),
                "definitely-not-a-real-binary-xyz",
                branch,
                base,
                "t",
                "b",
                false,
            );
            let PrCreateOutcome::Failed { message } = outcome else {
                panic!("a dash ref must be rejected before the tool probe");
            };
            assert!(
                message.contains("invalid branch/base name"),
                "validate_ref rejection reaches create: {message}"
            );
        }
    }

    #[test]
    #[cfg(unix)]
    fn create_or_recover_recovers_an_existing_open_pr_when_create_fails() {
        // The half-done shape: a previous create landed the PR on GitHub but
        // the app died before persisting, so every retry's `pr create` fails
        // with "already exists". Recovery resolves it via `pr view` and maps
        // the retry to Created instead of failing forever.
        let tmp = tempfile::TempDir::new().expect("temp dir");
        let script = fake_gh(
            tmp.path(),
            r#"if [ "$2" = "create" ]; then
  cat > /dev/null
  echo 'a pull request for branch "nc/t-1" into branch "main" already exists' >&2
  exit 1
fi
if [ "$2" = "view" ]; then
  printf '%s\n' "$@" > view-args.txt
  echo '{"url":"https://github.com/acme/widget/pull/9","number":9,"state":"OPEN"}'
  exit 0
fi
exit 1"#,
        );
        let outcome = create_or_recover_with(
            tmp.path(),
            script.to_str().expect("utf8 path"),
            "nc/t-1",
            "main",
            "t",
            "b",
            false,
        );
        let PrCreateOutcome::Created { url, number } = outcome else {
            panic!("a failed create with an existing open PR must recover to Created");
        };
        assert_eq!(url, "https://github.com/acme/widget/pull/9");
        assert_eq!(number, 9);
        // The recovery asked `pr view` for the branch's url/number/state.
        let args = std::fs::read_to_string(tmp.path().join("view-args.txt")).expect("args");
        assert!(args.contains("view"), "recovery path used pr view: {args}");
        assert!(args.contains("nc/t-1"), "view targets the branch: {args}");
    }

    #[test]
    #[cfg(unix)]
    fn create_or_recover_surfaces_the_original_error_when_no_pr_exists() {
        // A genuine create failure (nothing on GitHub) must keep the create's
        // own stderr, not a recovery artifact.
        let tmp = tempfile::TempDir::new().expect("temp dir");
        let script = fake_gh(
            tmp.path(),
            r#"if [ "$2" = "create" ]; then
  cat > /dev/null
  echo 'gh: authentication required' >&2
  exit 1
fi
echo 'no pull requests found' >&2
exit 1"#,
        );
        let outcome = create_or_recover_with(
            tmp.path(),
            script.to_str().expect("utf8 path"),
            "nc/t-1",
            "main",
            "t",
            "b",
            false,
        );
        let PrCreateOutcome::Failed { message } = outcome else {
            panic!("no recoverable PR ⇒ the original failure surfaces");
        };
        assert_eq!(
            message, "gh: authentication required",
            "the CREATE error is kept, not the view's"
        );
    }

    #[test]
    #[cfg(unix)]
    fn create_or_recover_recovers_the_zero_exit_no_url_branch_too() {
        // gh exits 0 but prints no URL (the unusable-output branch): recovery
        // still resolves the PR via view, so the user is not stranded.
        let tmp = tempfile::TempDir::new().expect("temp dir");
        let script = fake_gh(
            tmp.path(),
            r#"if [ "$2" = "create" ]; then
  cat > /dev/null
  echo 'no url in this output'
  exit 0
fi
if [ "$2" = "view" ]; then
  echo '{"url":"https://github.com/acme/widget/pull/12","number":12,"state":"OPEN"}'
  exit 0
fi
exit 1"#,
        );
        let outcome = create_or_recover_with(
            tmp.path(),
            script.to_str().expect("utf8 path"),
            "nc/t-1",
            "main",
            "t",
            "b",
            false,
        );
        assert!(
            matches!(outcome, PrCreateOutcome::Created { number: 12, .. }),
            "the zero-exit-no-URL create recovers through pr view"
        );
    }
}
