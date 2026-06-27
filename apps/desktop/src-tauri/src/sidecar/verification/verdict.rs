//! The pure verification logic (no I/O, no `AppHandle`): parse a reviewer's
//! machine-readable verdict, and merge a decompose re-run's proposed subtasks.
//! Both are total functions over plain values, so they unit-test directly.

use crate::task::{ProposedSubtask, SubtaskStatus};

/// The verdict an independent reviewer returned. Parsed from its final message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Pass,
    ChangesRequested,
    Fail,
}

/// Parse the machine-readable verdict from a reviewer's result text. The reviewer
/// is instructed to end with a single `VERDICT: PASS|CHANGES_REQUESTED|FAIL` line;
/// we grep for the last match (the final verdict wins). No token ⇒ `Fail`
/// (fail-safe: never silently pass).
pub fn parse_verdict(text: &str) -> Verdict {
    let mut found: Option<Verdict> = None;
    for line in text.lines() {
        if let Some(rest) = line.split_once("VERDICT:") {
            let token = rest.1.trim();
            let verdict = if token.starts_with("PASS") {
                Some(Verdict::Pass)
            } else if token.starts_with("CHANGES_REQUESTED") {
                Some(Verdict::ChangesRequested)
            } else if token.starts_with("FAIL") {
                Some(Verdict::Fail)
            } else {
                None
            };
            if let Some(v) = verdict {
                found = Some(v); // last match wins
            }
        }
    }
    found.unwrap_or(Verdict::Fail)
}

/// Merge a decompose re-run's freshly-parsed proposals with the task's existing
/// ones, PRESERVING any already-`Converted` proposal (and its `linked_task_id`) so a
/// re-run never orphans a converted child task or loses its bookkeeping. The kept
/// converted proposals come first (original order), then the fresh proposals. On a
/// first run `existing` is empty, so the result is just `fresh`.
pub fn merge_proposed_subtasks(
    existing: &[ProposedSubtask],
    fresh: Vec<ProposedSubtask>,
) -> Vec<ProposedSubtask> {
    let mut merged: Vec<ProposedSubtask> = existing
        .iter()
        .filter(|s| s.status == SubtaskStatus::Converted)
        .cloned()
        .collect();
    merged.extend(fresh);
    merged
}

#[cfg(test)]
mod tests {
    use super::{merge_proposed_subtasks, parse_verdict, Verdict};
    use crate::task::{ProposedSubtask, RunMode, SubtaskStatus};

    #[test]
    fn run_mode_is_worktree_predicate() {
        assert!(!RunMode::Main.is_worktree());
        assert!(RunMode::Worktree.is_worktree());
    }

    #[test]
    fn verdict_parses_each_token() {
        assert_eq!(parse_verdict("ok\nVERDICT: PASS"), Verdict::Pass);
        assert_eq!(
            parse_verdict("VERDICT: CHANGES_REQUESTED"),
            Verdict::ChangesRequested
        );
        assert_eq!(parse_verdict("VERDICT: FAIL"), Verdict::Fail);
    }

    #[test]
    fn verdict_last_match_wins() {
        // A reviewer that mentions an earlier verdict then concludes with another:
        // the final line is authoritative.
        let text = "first I thought VERDICT: FAIL\nbut actually\nVERDICT: PASS";
        assert_eq!(parse_verdict(text), Verdict::Pass);
    }

    #[test]
    fn verdict_tolerates_trailing_rationale_on_the_line() {
        assert_eq!(parse_verdict("VERDICT: PASS — looks good"), Verdict::Pass);
    }

    #[test]
    fn no_verdict_token_fails_safe() {
        // Fail-safe: an unparseable / token-less review never silently passes.
        assert_eq!(
            parse_verdict("I forgot to include a verdict line"),
            Verdict::Fail
        );
        assert_eq!(parse_verdict(""), Verdict::Fail);
        assert_eq!(parse_verdict("VERDICT: MAYBE"), Verdict::Fail);
    }

    #[test]
    fn proposed_subtask_from_wire_mints_core_owned_fields() {
        use serde_json::json;
        // A valid wire `{title, prompt}` object is minted into a ProposedSubtask: the
        // title/prompt come from the wire, but the id (fresh uuid), Open status, and
        // empty link are core-owned — never taken from the model's output.
        let a = ProposedSubtask::from_wire(&json!({
            "title": "Add the schema",
            "prompt": "Create the table"
        }))
        .expect("a valid item is minted");
        let b = ProposedSubtask::from_wire(&json!({
            "title": "Wire the UI",
            "prompt": "Build the form"
        }))
        .expect("a valid item is minted");
        assert_eq!(a.title, "Add the schema");
        assert_eq!(a.prompt, "Create the table");
        assert_eq!(a.status, SubtaskStatus::Open);
        assert!(a.linked_task_id.is_none());
        assert!(
            !a.id.is_empty() && a.id != b.id,
            "each item gets a fresh, distinct uuid"
        );

        // A blank/whitespace-only title is dropped (None ⇒ filtered out of the array).
        assert!(
            ProposedSubtask::from_wire(&json!({"title": "  ", "prompt": "skip me"})).is_none(),
            "blank title is dropped"
        );
        // A missing title is dropped (a prompt alone is not a proposal).
        assert!(
            ProposedSubtask::from_wire(&json!({"prompt": "no title"})).is_none(),
            "missing title is dropped"
        );
        // A missing prompt defaults to empty; the item still mints.
        let c = ProposedSubtask::from_wire(&json!({"title": "only a title"}))
            .expect("a title alone still mints");
        assert_eq!(c.prompt, "", "missing prompt defaults to empty");
    }

    #[test]
    fn merge_preserves_converted_proposals_across_a_rerun() {
        // A re-run of a decompose task must keep already-converted proposals (so
        // their children aren't orphaned) and append the freshly-parsed ones.
        let existing = vec![
            ProposedSubtask {
                id: "kept".into(),
                title: "Already shipped".into(),
                prompt: "x".into(),
                status: SubtaskStatus::Converted,
                linked_task_id: Some("child-1".into()),
            },
            ProposedSubtask {
                id: "stale-open".into(),
                title: "Not yet converted".into(),
                prompt: "y".into(),
                status: SubtaskStatus::Open,
                linked_task_id: None,
            },
        ];
        // The fresh proposals are what the reader builds from the wire array (each
        // minted Open + unlinked).
        let fresh = vec![ProposedSubtask {
            id: "fresh-1".into(),
            title: "new one".into(),
            prompt: "z".into(),
            status: SubtaskStatus::Open,
            linked_task_id: None,
        }];
        let merged = merge_proposed_subtasks(&existing, fresh);
        // The converted proposal survives (with its link); the stale OPEN one is
        // dropped in favor of the fresh proposal.
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].id, "kept");
        assert_eq!(merged[0].linked_task_id.as_deref(), Some("child-1"));
        assert_eq!(merged[1].title, "new one");
        assert_eq!(merged[1].status, SubtaskStatus::Open);
    }

    #[test]
    fn merge_on_a_first_run_is_just_the_fresh_proposals() {
        let fresh = vec![ProposedSubtask {
            id: "a".into(),
            title: "first".into(),
            prompt: "p".into(),
            status: SubtaskStatus::Open,
            linked_task_id: None,
        }];
        let merged = merge_proposed_subtasks(&[], fresh.clone());
        assert_eq!(merged, fresh);
    }
}
