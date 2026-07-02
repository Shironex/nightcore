//! `list_open_prs` — a read-only `gh pr list` for the PR Review config picker, so
//! the user selects a pull request from a list instead of typing its number.
//!
//! Same posture as the rest of the `gh` seam: bounded by a deadline via
//! [`super::pr::run_gh_bounded`]; `gh` is the seam and stores no tokens; the repo
//! is the active project's; every text field is gh pass-through (untrusted
//! contributor content) that the web renders as inert text and never feeds to a
//! model. Read-only — no mutation, no lease.

use std::path::Path;
use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;
#[cfg(test)]
use ts_rs::TS;

use super::merge::require_project;
use super::pr::{run_gh_bounded, GH_BINARY};

const GH_LIST_TIMEOUT: Duration = Duration::from_secs(60);
/// The `--json` field set the picker renders. `author` is a nested object.
const PR_LIST_FIELDS: &str = "number,title,headRefName,author,isDraft,updatedAt";
/// A generous ceiling; the picker also accepts a typed number for PRs beyond it.
const PR_LIST_LIMIT: &str = "50";

/// One open pull request for the PR Review picker. All text fields are gh
/// pass-through (any contributor's content) — inert display only, never a model
/// input, never shell-interpolated.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export, export_to = "PrSummary.ts"))]
pub struct PrSummary {
    pub number: u64,
    pub title: String,
    /// The PR's head branch name.
    pub head_ref_name: String,
    /// The PR author's GitHub login, or `unknown` when gh omits it.
    pub author: String,
    pub is_draft: bool,
    /// gh-reported ISO-8601 update timestamp; the web formats it locally.
    pub updated_at: String,
}

/// The `gh pr list --json` row shape. Everything beyond `number` is optional with
/// a safe default, so gh field/vocabulary drift degrades a row — never the list.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhPrListItem {
    number: u64,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    head_ref_name: Option<String>,
    #[serde(default)]
    author: Option<GhAuthor>,
    #[serde(default)]
    is_draft: Option<bool>,
    #[serde(default)]
    updated_at: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct GhAuthor {
    #[serde(default)]
    login: Option<String>,
}

impl GhPrListItem {
    fn into_summary(self) -> PrSummary {
        PrSummary {
            number: self.number,
            title: self.title.unwrap_or_default(),
            head_ref_name: self.head_ref_name.unwrap_or_default(),
            author: self
                .author
                .and_then(|a| a.login)
                .unwrap_or_else(|| "unknown".to_string()),
            is_draft: self.is_draft.unwrap_or(false),
            updated_at: self.updated_at.unwrap_or_default(),
        }
    }
}

/// Parse `gh pr list --json` stdout into the wire contract. Pure + unit-tested.
/// An empty body (no open PRs) is a clean empty list, not an error.
fn parse_pr_list(stdout: &str) -> Result<Vec<PrSummary>, String> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let items: Vec<GhPrListItem> = serde_json::from_str(trimmed)
        .map_err(|e| format!("could not parse gh pr list output: {e}"))?;
    Ok(items.into_iter().map(GhPrListItem::into_summary).collect())
}

/// The bounded seam — `binary`-parameterized so tests inject a fake `gh`.
fn list_open_prs_with(
    dir: &Path,
    binary: &str,
    deadline: Duration,
) -> Result<Vec<PrSummary>, String> {
    // Probe first so an absent tool is a clear install message, not a raw spawn error.
    if which::which(binary).is_err() {
        return Err(
            "GitHub CLI (`gh`) is not installed — install it to list pull requests".to_string(),
        );
    }
    let out = run_gh_bounded(
        dir,
        binary,
        &[
            "pr",
            "list",
            "--state",
            "open",
            "--limit",
            PR_LIST_LIMIT,
            "--json",
            PR_LIST_FIELDS,
        ],
        None,
        deadline,
        "timed out listing pull requests — check your network and try again",
    )?;
    if !out.status.success() {
        let stderr = out.stderr.trim();
        return Err(if stderr.is_empty() {
            format!("`{binary} pr list` failed (exit {:?})", out.status.code())
        } else {
            // gh's stderr explains itself (auth, no remote, unknown repo, …).
            stderr.to_string()
        });
    }
    parse_pr_list(&out.stdout)
}

fn list_open_prs_blocking(app: &AppHandle) -> Result<Vec<PrSummary>, String> {
    let project = require_project(app)?;
    let dir = std::path::PathBuf::from(&project.path);
    list_open_prs_with(&dir, GH_BINARY, GH_LIST_TIMEOUT)
}

/// List the active project's open pull requests for the PR Review picker. Runs off
/// the UI thread (the network `gh` spawn must not block the WKWebView).
#[tauri::command]
pub async fn list_open_prs(app: AppHandle) -> Result<Vec<PrSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || list_open_prs_blocking(&app))
        .await
        .map_err(|e| format!("list pull requests failed to run: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_pr_list_flattens_author_and_defaults_missing_fields() {
        let json = r#"[
            {"number": 42, "title": "Fix the thing", "headRefName": "nc/fix",
             "author": {"login": "alice"}, "isDraft": false, "updatedAt": "2026-07-02T10:00:00Z"},
            {"number": 41, "author": null}
        ]"#;
        let prs = parse_pr_list(json).expect("parses");
        assert_eq!(prs.len(), 2);
        assert_eq!(prs[0].number, 42);
        assert_eq!(prs[0].author, "alice");
        assert_eq!(prs[0].head_ref_name, "nc/fix");
        assert!(!prs[0].is_draft);
        // A row missing everything but `number` degrades gracefully, not drops.
        assert_eq!(prs[1].number, 41);
        assert_eq!(prs[1].author, "unknown");
        assert_eq!(prs[1].title, "");
    }

    #[test]
    fn parse_pr_list_empty_output_is_an_empty_list() {
        assert_eq!(parse_pr_list("").expect("ok"), Vec::new());
        assert_eq!(parse_pr_list("   \n").expect("ok"), Vec::new());
        assert_eq!(parse_pr_list("[]").expect("ok"), Vec::new());
    }

    #[test]
    fn parse_pr_list_malformed_json_is_an_error_not_a_panic() {
        assert!(parse_pr_list("not json").is_err());
        assert!(parse_pr_list("{\"number\":1}").is_err()); // object, not an array
    }

    /// Write an executable shell script to stand in for `gh` (the phase-1/3/4 fixture
    /// pattern), exercising the real spawn + exit-code mapping.
    #[cfg(unix)]
    fn fake_gh(dir: &Path, body: &str) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join("fake-gh.sh");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("write script");
        let mut perms = std::fs::metadata(&path).expect("meta").permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&path, perms).expect("chmod");
        path
    }

    #[test]
    #[cfg(unix)]
    fn list_open_prs_with_requests_open_state_and_the_json_fields() {
        let tmp = tempfile::TempDir::new().expect("temp dir");
        let script = fake_gh(
            tmp.path(),
            "printf '%s\\n' \"$@\" >> args.txt\n\
             printf '[{\"number\":7,\"title\":\"t\",\"headRefName\":\"b\",\"author\":{\"login\":\"bob\"},\"isDraft\":true,\"updatedAt\":\"x\"}]'\n\
             exit 0",
        );
        let prs = list_open_prs_with(
            tmp.path(),
            script.to_str().expect("utf8 path"),
            GH_LIST_TIMEOUT,
        )
        .expect("list succeeds");
        assert_eq!(
            prs,
            vec![PrSummary {
                number: 7,
                title: "t".into(),
                head_ref_name: "b".into(),
                author: "bob".into(),
                is_draft: true,
                updated_at: "x".into(),
            }]
        );
        let args = std::fs::read_to_string(tmp.path().join("args.txt")).expect("args");
        assert!(args.contains("list"), "invokes `gh pr list`");
        assert!(args.contains("--state\nopen"), "requests only open PRs");
        assert!(args.contains(PR_LIST_FIELDS), "asks for the picker fields");
    }

    #[test]
    #[cfg(unix)]
    fn list_open_prs_with_surfaces_stderr_verbatim_on_failure() {
        let tmp = tempfile::TempDir::new().expect("temp dir");
        let script = fake_gh(
            tmp.path(),
            "echo 'gh: no default remote repository' 1>&2\nexit 1",
        );
        let err = list_open_prs_with(
            tmp.path(),
            script.to_str().expect("utf8 path"),
            GH_LIST_TIMEOUT,
        )
        .expect_err("a failing gh is an error");
        assert!(err.contains("no default remote repository"));
    }
}
