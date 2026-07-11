//! Upstream-event projection (#97, spec §5) — the "closed upstream" chip's data
//! source. READS ONLY: no mutation lease, no issue write. A poll re-lists the active
//! repo's OPEN issues, then CONFIRMS every linked issue that fell OUT of that set with
//! a single batched `gh api graphql` state fetch — guarding the list-cap false
//! positive a naive "absent ⇒ closed" diff would get wrong (`list_open_issues` caps at
//! `ISSUES_LIST_MAX`, so absence is ambiguous: closed, or just off the first page).
//!
//! Two more pieces live here: the pure resolution rules ([`resolve_states`]) that fold
//! the open set + the confirmed set into each linked issue's last-observed state, and
//! [`open_issue_in_browser`] — the chip's click action (`gh issue view <n> --web`),
//! read-only (it opens a page, never mutates the issue).
//!
//! Every `gh` child rides the hardened seam ([`run_gh_bounded`], which applies the
//! git-env scrub); issue numbers are `u64` rendered decimal (injection-safe) and the
//! GraphQL alias names are our own — nothing untrusted is interpolated.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::Duration;

use serde::Deserialize;

use crate::git::gh::{map_gh_failure, probe_gh, run_gh_bounded, GH_BINARY};
use crate::workflow::issue_triage::list_open_issues;

/// The lowercased wire string for an open issue — the projection stamps this (or the
/// confirmed `closed` string GitHub returns) on `task.issue_state`.
const ISSUE_STATE_OPEN: &str = "open";

/// Deadline for the batched state-confirm `gh api graphql` call (a small aliased query
/// — generous but finite, so a black-holed GitHub errors out rather than pinning the
/// blocking thread).
const GH_STATE_TIMEOUT: Duration = Duration::from_secs(60);

/// Deadline for the `gh issue view --web` browser-open (it exits right after handing the
/// URL to the OS opener).
const GH_OPEN_TIMEOUT: Duration = Duration::from_secs(30);

/// Cap on the suspected-closed set carried in one batched confirm query — defense in
/// depth bounding the GraphQL alias fan-out even if a project accrues many linked tasks.
const STATE_CONFIRM_MAX: usize = 100;

/// One linked issue's resolved last-observed upstream state.
pub(crate) struct IssueStateProjection {
    pub(crate) number: u64,
    /// The lowercased wire state — `open` or `closed`.
    pub(crate) state: String,
}

/// Build the batched confirm query: ONE GraphQL request fetching each suspected issue's
/// state via a stable alias (`_0: issue(number:N){number state} …`). Numbers are `u64`
/// rendered decimal (injection-safe) and the alias names are our own, so nothing
/// untrusted is interpolated. `numbers` must be non-empty.
fn build_state_query(numbers: &[u64]) -> String {
    let mut fields = String::new();
    for (i, number) in numbers.iter().enumerate() {
        fields.push_str(&format!("_{i}:issue(number:{number}){{number state}} "));
    }
    format!(
        "query($owner:String!,$name:String!){{repository(owner:$owner,name:$name){{{fields}}}}}"
    )
}

/// The batched-state GraphQL envelope. `repository` is an object of alias → issue node
/// (`{{ _0: {{number,state}}, _1: null, … }}`); a null alias (deleted/inaccessible
/// issue) deserializes to `None` and is dropped. Both `data`/`errors` optional so a
/// failed query (HTTP 200 + null `data` + an `errors` array) still parses.
#[derive(Debug, Deserialize)]
struct StateResponse {
    data: Option<StateData>,
    errors: Option<Vec<StateError>>,
}

#[derive(Debug, Deserialize)]
struct StateError {
    #[serde(default)]
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StateData {
    #[serde(default)]
    repository: Option<HashMap<String, Option<StateNode>>>,
}

#[derive(Debug, Deserialize)]
struct StateNode {
    #[serde(default)]
    number: Option<u64>,
    #[serde(default)]
    state: Option<String>,
}

/// Parse a batched state-confirm payload into `number → lowercased state`. PURE —
/// unit-tested off fixed payloads. errors[]-FIRST (a failed query rides an HTTP 200
/// with a null `data`), then a null `repository` is a not-found. A null alias or a node
/// missing its number/state is dropped, so the caller leaves that task's chip untouched
/// rather than guessing a state.
fn parse_issue_states(stdout: &str) -> Result<HashMap<u64, String>, String> {
    let response: StateResponse = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("`gh api graphql` returned unparseable JSON: {e}"))?;

    if let Some(errors) = response.errors.as_ref() {
        if !errors.is_empty() {
            let joined = errors
                .iter()
                .filter_map(|e| e.message.as_deref())
                .map(str::trim)
                .filter(|m| !m.is_empty())
                .collect::<Vec<_>>()
                .join("; ");
            return Err(if joined.is_empty() {
                "GitHub returned an error for the issue-state query".to_string()
            } else {
                joined
            });
        }
    }

    let repository = response
        .data
        .and_then(|d| d.repository)
        .ok_or_else(|| "the repository was not found on GitHub".to_string())?;

    let mut states = HashMap::new();
    for node in repository.into_values().flatten() {
        if let (Some(number), Some(state)) = (node.number, node.state) {
            states.insert(number, state.to_ascii_lowercase());
        }
    }
    Ok(states)
}

/// Fetch the state of each `numbers` issue in ONE batched `gh api graphql` call.
/// Binary-parameterized so tests inject a fake `gh` (the `list.rs` fixture idiom).
/// `numbers` must be non-empty and already capped by the caller.
fn fetch_issue_states_with(
    dir: &Path,
    binary: &str,
    numbers: &[u64],
    deadline: Duration,
) -> Result<HashMap<u64, String>, String> {
    probe_gh(binary, "install it to check issue states")?;
    let query_arg = format!("query={}", build_state_query(numbers));
    let out = run_gh_bounded(
        dir,
        binary,
        &[
            "api",
            "graphql",
            "-F",
            "owner={owner}",
            "-F",
            "name={repo}",
            "-f",
            &query_arg,
        ],
        None,
        deadline,
        "timed out checking issue states on GitHub — check your network and try again",
    )?;
    if !out.status.success() {
        return Err(map_gh_failure(binary, "api graphql", &out));
    }
    parse_issue_states(&out.stdout)
}

/// Resolve each linked issue's last-observed state from the OPEN set + the confirmed
/// states of the suspected-absent ones. PURE — the §5 detection rules:
///  - present in the OPEN set ⇒ `open` (clears a stale chip on reopen);
///  - absent but CONFIRMED `open` (fell off the list cap) ⇒ `open` (false-positive guard);
///  - absent and CONFIRMED `closed` ⇒ `closed`;
///  - absent and UNCONFIRMED (deleted / query gap) ⇒ dropped (leave the chip as-is).
fn resolve_states(
    linked: &[u64],
    open_set: &HashSet<u64>,
    confirmed: &HashMap<u64, String>,
) -> Vec<IssueStateProjection> {
    let mut out = Vec::new();
    for &number in linked {
        let state = if open_set.contains(&number) {
            Some(ISSUE_STATE_OPEN.to_string())
        } else {
            confirmed.get(&number).cloned()
        };
        if let Some(state) = state {
            out.push(IssueStateProjection { number, state });
        }
    }
    out
}

/// Project the upstream state of every `linked` issue, reading GitHub in `dir` (the
/// active project root, which resolves `{owner}/{repo}`). ONE open-issue list + at most
/// ONE batched state-confirm call (skipped when nothing fell off the open list).
/// `linked` should be deduped; the confirm set is capped at [`STATE_CONFIRM_MAX`].
pub(crate) fn project_issue_states(
    dir: &Path,
    linked: &[u64],
) -> Result<Vec<IssueStateProjection>, String> {
    if linked.is_empty() {
        return Ok(Vec::new());
    }
    let open_set: HashSet<u64> = list_open_issues(dir)?
        .into_iter()
        .map(|issue| issue.number)
        .collect();
    let suspected: Vec<u64> = linked
        .iter()
        .copied()
        .filter(|n| !open_set.contains(n))
        .take(STATE_CONFIRM_MAX)
        .collect();
    let confirmed = if suspected.is_empty() {
        HashMap::new()
    } else {
        fetch_issue_states_with(dir, GH_BINARY, &suspected, GH_STATE_TIMEOUT)?
    };
    Ok(resolve_states(linked, &open_set, &confirmed))
}

/// Open issue `number` on GitHub in the user's browser (`gh issue view <n> --web`, run
/// in the active project `dir` so `gh` resolves the repo from its remote). The chip's
/// click action — READ-ONLY (it opens a page, never mutates the issue).
pub(crate) fn open_issue_in_browser(dir: &Path, number: u64) -> Result<(), String> {
    open_issue_in_browser_with(dir, GH_BINARY, number, GH_OPEN_TIMEOUT)
}

/// Binary-parameterized browser-open — the fake-`gh` argv seam. `number` is a `u64`
/// rendered decimal (injection-safe); a zero is rejected before spawn.
fn open_issue_in_browser_with(
    dir: &Path,
    binary: &str,
    number: u64,
    deadline: Duration,
) -> Result<(), String> {
    if number == 0 {
        return Err("no issue number to open (a positive integer is required)".to_string());
    }
    probe_gh(binary, "install it to open issues")?;
    let number_arg = number.to_string();
    let out = run_gh_bounded(
        dir,
        binary,
        &["issue", "view", &number_arg, "--web"],
        None,
        deadline,
        "timed out opening the issue on GitHub — check your network and try again",
    )?;
    if out.status.success() {
        return Ok(());
    }
    Err(map_gh_failure(binary, "issue view", &out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    fn fake_gh(dir: &Path, body: &str) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join("fake-gh.sh");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("write script");
        let mut perms = std::fs::metadata(&path).expect("metadata").permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&path, perms).expect("chmod");
        path
    }

    #[test]
    fn build_state_query_aliases_each_number() {
        let query = build_state_query(&[7, 42]);
        assert!(query.contains("_0:issue(number:7){number state}"));
        assert!(query.contains("_1:issue(number:42){number state}"));
        assert!(query.starts_with("query($owner:String!,$name:String!)"));
    }

    #[test]
    fn parse_issue_states_lowercases_and_drops_nulls() {
        let payload = serde_json::json!({
            "data": { "repository": {
                "_0": { "number": 7, "state": "CLOSED" },
                "_1": { "number": 42, "state": "OPEN" },
                "_2": null,
                "_3": { "number": null, "state": "OPEN" }
            } }
        })
        .to_string();
        let states = parse_issue_states(&payload).expect("parse");
        assert_eq!(states.get(&7).map(String::as_str), Some("closed"));
        assert_eq!(states.get(&42).map(String::as_str), Some("open"));
        assert!(!states.contains_key(&0), "a null alias is dropped");
        assert_eq!(states.len(), 2, "the number-less node is dropped too");
    }

    #[test]
    fn parse_issue_states_errors_array_takes_precedence() {
        let payload = serde_json::json!({
            "data": null,
            "errors": [{ "message": "Could not resolve to a Repository" }]
        })
        .to_string();
        let err = parse_issue_states(&payload).unwrap_err();
        assert!(err.contains("Could not resolve to a Repository"));
    }

    #[test]
    fn parse_issue_states_null_repository_is_a_not_found() {
        let payload = serde_json::json!({ "data": { "repository": null } }).to_string();
        assert!(parse_issue_states(&payload)
            .unwrap_err()
            .contains("not found"));
    }

    #[test]
    fn resolve_states_marks_a_confirmed_close() {
        // #7 is linked, absent from the open set, and the confirm says CLOSED.
        let open: HashSet<u64> = [42].into_iter().collect();
        let confirmed: HashMap<u64, String> = [(7, "closed".to_string())].into_iter().collect();
        let out = resolve_states(&[7, 42], &open, &confirmed);
        let by: HashMap<u64, String> = out.into_iter().map(|p| (p.number, p.state)).collect();
        assert_eq!(by.get(&7).map(String::as_str), Some("closed"));
        assert_eq!(
            by.get(&42).map(String::as_str),
            Some("open"),
            "present ⇒ open"
        );
    }

    #[test]
    fn resolve_states_guards_the_list_cap_false_positive() {
        // #7 fell off the open-list cap (absent) but the targeted confirm says OPEN —
        // it must resolve to `open`, NOT a false-positive close.
        let open: HashSet<u64> = HashSet::new();
        let confirmed: HashMap<u64, String> = [(7, "open".to_string())].into_iter().collect();
        let out = resolve_states(&[7], &open, &confirmed);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].state, "open");
    }

    #[test]
    fn resolve_states_reopen_flips_back_to_open() {
        // A previously-closed issue reappears in the open set ⇒ `open` (the chip clears).
        let open: HashSet<u64> = [7].into_iter().collect();
        let confirmed: HashMap<u64, String> = HashMap::new();
        let out = resolve_states(&[7], &open, &confirmed);
        assert_eq!(out[0].state, "open");
    }

    #[test]
    fn resolve_states_drops_an_unconfirmed_absent_issue() {
        // Absent from the open set AND not in the confirm map (deleted / query gap) ⇒
        // no projection, so the existing chip is left untouched.
        let out = resolve_states(&[7], &HashSet::new(), &HashMap::new());
        assert!(out.is_empty());
    }

    #[test]
    #[cfg(unix)]
    fn open_issue_in_browser_calls_gh_issue_view_web() {
        let tmp = tempfile::TempDir::new().expect("tempdir");
        let gh = fake_gh(tmp.path(), "printf '%s\\n' \"$@\" > args.txt");
        open_issue_in_browser_with(tmp.path(), gh.to_str().unwrap(), 99, Duration::from_secs(5))
            .expect("open succeeds");
        let args = std::fs::read_to_string(tmp.path().join("args.txt")).expect("args");
        let args: Vec<&str> = args.lines().collect();
        for expected in ["issue", "view", "99", "--web"] {
            assert!(
                args.contains(&expected),
                "argv missing {expected}: {args:?}"
            );
        }
    }

    #[test]
    fn open_issue_in_browser_rejects_a_zero_number_before_spawn() {
        let err = open_issue_in_browser_with(Path::new("/tmp"), "gh", 0, Duration::from_secs(1))
            .unwrap_err();
        assert!(err.contains("positive integer"));
    }

    #[test]
    #[cfg(unix)]
    fn fetch_issue_states_surfaces_a_gh_failure() {
        let tmp = tempfile::TempDir::new().expect("tempdir");
        let gh = fake_gh(
            tmp.path(),
            "echo 'gh: Bad credentials (HTTP 401)' 1>&2\nexit 1",
        );
        let err = fetch_issue_states_with(
            tmp.path(),
            gh.to_str().unwrap(),
            &[7],
            Duration::from_secs(5),
        )
        .expect_err("a gh failure surfaces");
        assert!(err.contains("401"), "surfaces gh stderr: {err}");
    }

    #[test]
    #[cfg(unix)]
    fn fetch_issue_states_parses_a_batched_payload() {
        let tmp = tempfile::TempDir::new().expect("tempdir");
        let payload =
            serde_json::json!({ "data": { "repository": { "_0": { "number": 7, "state": "CLOSED" } } } })
                .to_string();
        let gh = fake_gh(tmp.path(), &format!("cat <<'JSON'\n{payload}\nJSON"));
        let states = fetch_issue_states_with(
            tmp.path(),
            gh.to_str().unwrap(),
            &[7],
            Duration::from_secs(5),
        )
        .expect("parse");
        assert_eq!(states.get(&7).map(String::as_str), Some("closed"));
    }
}
