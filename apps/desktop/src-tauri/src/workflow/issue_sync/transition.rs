//! The transition → action table (§3.2): the PURE functions that map a `Task`'s state
//! to the label it should carry and the comment it should post. No `AppHandle`, no `gh`,
//! no clock — unit-tested as a truth table, and used by the command to compute the
//! writeback delta BEFORE acquiring the lease (so an unchanged task is a zero-`gh` no-op).

use super::labels::full_name;
use crate::task::{Task, TaskStatus};

/// The stable `nc:*` label SUFFIX for a task's state (§3.2), or `None` when the issue
/// should carry NO `nc:*` label — a merged task, whose closed state comes from `Closes #N`
/// in the PR body, not a label. Prefix-independent + `&'static` (the command composes the
/// full name with the configured prefix). Collapses the 7 `TaskStatus` variants into the
/// 5-label vocabulary so Backlog↔Ready / InProgress↔Verifying churn does not re-label.
pub(super) fn desired_label(task: &Task) -> Option<&'static str> {
    if task.merged {
        return None;
    }
    Some(match task.status {
        TaskStatus::Backlog | TaskStatus::Ready => "queued",
        TaskStatus::InProgress | TaskStatus::Verifying => "in-progress",
        TaskStatus::WaitingApproval => "review",
        TaskStatus::Done => "done",
        TaskStatus::Failed => "failed",
    })
}

/// The terminal COMMENT key to post for a task's state (§3.2), or `None`. Pure.
///
/// The once-only `converted` "tracking" comment is keyed on the DURABLE
/// `issue_comment_marker`, NOT on the transient `Backlog`/`Ready` status. A fast
/// Backlog→Done transition coalesces (the 500 ms observer debounce, §3.6) into a single
/// `sync_issue_status` call carrying the LATEST state — so gating `converted` on the
/// status being Backlog/Ready would DROP it whenever the task raced past those states
/// before the first sync fired. Keyed on the marker instead, the first-ever sync of any
/// issue-linked task (marker unset) posts `converted` exactly once — regardless of how
/// far the status has already advanced — and, once the marker is set, never re-posts it
/// (a Done→Backlog→Done flap is inert). The `done`/`failed` keys are returned for their
/// terminal state once `converted` has posted; the command's marker guard ([`Pending`])
/// makes each post at most once.
pub(super) fn comment_key(task: &Task) -> Option<&'static str> {
    if task.merged {
        return None;
    }
    // First-ever sync (no comment ever posted) ⇒ the tracking comment, whatever the
    // status has coalesced to. This survives a Backlog→Done fast-path.
    if task.issue_comment_marker.is_none() {
        return Some("converted");
    }
    match task.status {
        TaskStatus::Failed => Some("failed"),
        TaskStatus::Done => Some("done"),
        TaskStatus::Backlog
        | TaskStatus::Ready
        | TaskStatus::InProgress
        | TaskStatus::Verifying
        | TaskStatus::WaitingApproval => None,
    }
}

/// The writeback deltas for a task under `prefix`, computed PURELY (no `gh`) so the
/// command can early-out with zero network calls when nothing changed (§3.6 step 4).
pub(crate) struct Pending {
    /// The vocabulary suffix of the desired label (for the fixed color/description lookup
    /// at `ensure` time); `None` when the issue should carry no `nc:*` label.
    pub(super) desired_suffix: Option<&'static str>,
    /// The full label the issue SHOULD carry (`None` = no `nc:*` label — a merged task).
    pub(super) desired_full: Option<String>,
    /// The prior full label to remove on a switch — the task's `issue_synced_label`.
    pub(super) prev_full: Option<String>,
    /// The comment key due to post NOW (marker-guarded); `None` when already posted or not
    /// a comment state.
    pub(super) comment_due: Option<&'static str>,
}

impl Pending {
    /// Whether the desired label differs from the one last projected (the anti-churn key).
    pub(super) fn label_changed(&self) -> bool {
        self.desired_full != self.prev_full
    }

    /// Whether this writeback is a pure no-op (label unchanged AND no comment due) — the
    /// command returns early on `true`, issuing zero `gh` calls.
    pub(crate) fn is_noop(&self) -> bool {
        !self.label_changed() && self.comment_due.is_none()
    }
}

/// Compute the [`Pending`] delta for `task` under the label `prefix`. Pure.
pub(crate) fn pending_work(task: &Task, prefix: &str) -> Pending {
    let desired_suffix = desired_label(task);
    let comment_due = match comment_key(task) {
        Some(k) if task.issue_comment_marker.as_deref() != Some(k) => Some(k),
        _ => None,
    };
    Pending {
        desired_suffix,
        desired_full: desired_suffix.map(|s| full_name(prefix, s)),
        prev_full: task.issue_synced_label.clone(),
        comment_due,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(status: TaskStatus) -> Task {
        let mut t = Task::new("Fix the parser".into(), "d".into());
        t.status = status;
        t
    }

    #[test]
    fn desired_label_collapses_seven_statuses_into_five() {
        assert_eq!(desired_label(&task(TaskStatus::Backlog)), Some("queued"));
        assert_eq!(desired_label(&task(TaskStatus::Ready)), Some("queued"));
        assert_eq!(
            desired_label(&task(TaskStatus::InProgress)),
            Some("in-progress")
        );
        assert_eq!(
            desired_label(&task(TaskStatus::Verifying)),
            Some("in-progress")
        );
        assert_eq!(
            desired_label(&task(TaskStatus::WaitingApproval)),
            Some("review")
        );
        assert_eq!(desired_label(&task(TaskStatus::Done)), Some("done"));
        assert_eq!(desired_label(&task(TaskStatus::Failed)), Some("failed"));
    }

    #[test]
    fn a_merged_task_carries_no_label_regardless_of_status() {
        for status in [TaskStatus::Done, TaskStatus::Verifying, TaskStatus::Failed] {
            let mut t = task(status);
            t.merged = true;
            assert_eq!(desired_label(&t), None, "merged ⇒ no nc:* label");
            assert_eq!(comment_key(&t), None, "merged ⇒ no comment");
        }
    }

    #[test]
    fn converted_is_keyed_on_the_marker_and_survives_coalescing() {
        // The first-ever sync (marker unset) posts `converted` regardless of how far the
        // status has advanced — so a fast Backlog→Done coalesce can't drop the tracking
        // comment (fix T2-3).
        for status in [
            TaskStatus::Backlog,
            TaskStatus::Ready,
            TaskStatus::InProgress,
            TaskStatus::Verifying,
            TaskStatus::WaitingApproval,
            TaskStatus::Done,
            TaskStatus::Failed,
        ] {
            assert_eq!(
                comment_key(&task(status)),
                Some("converted"),
                "marker-unset {status:?} posts the once-only converted comment"
            );
        }
    }

    #[test]
    fn comment_key_maps_terminals_once_converted_has_posted() {
        // Once the tracking comment has posted (marker set), terminals post their own key.
        let mut done = task(TaskStatus::Done);
        done.issue_comment_marker = Some("converted".into());
        assert_eq!(comment_key(&done), Some("done"));
        let mut failed = task(TaskStatus::Failed);
        failed.issue_comment_marker = Some("converted".into());
        assert_eq!(comment_key(&failed), Some("failed"));
        // ...and the non-terminal states post nothing.
        for status in [
            TaskStatus::Backlog,
            TaskStatus::Ready,
            TaskStatus::InProgress,
            TaskStatus::Verifying,
            TaskStatus::WaitingApproval,
        ] {
            let mut t = task(status);
            t.issue_comment_marker = Some("converted".into());
            assert_eq!(
                comment_key(&t),
                None,
                "{status:?} (converted) posts nothing"
            );
        }
        // A Done→Backlog→Done flap never re-posts `converted` (marker already `done`).
        let mut flap = task(TaskStatus::Backlog);
        flap.issue_comment_marker = Some("done".into());
        assert_eq!(comment_key(&flap), None, "converted is once-only");
    }

    #[test]
    fn pending_is_noop_when_label_and_comment_are_unchanged() {
        // InProgress already labeled in-progress, converted already posted → nothing to do.
        let mut t = task(TaskStatus::InProgress);
        t.issue_synced_label = Some("nc:in-progress".into());
        t.issue_comment_marker = Some("converted".into());
        let p = pending_work(&t, "nc:");
        assert!(p.is_noop(), "a settled in-progress task is a zero-gh no-op");
        assert!(!p.label_changed());
    }

    #[test]
    fn pending_computes_the_label_switch_and_terminal_comment() {
        // in-progress → done: label switches AND the `done` comment is due once.
        let mut t = task(TaskStatus::Done);
        t.issue_synced_label = Some("nc:in-progress".into());
        t.issue_comment_marker = Some("converted".into());
        let p = pending_work(&t, "nc:");
        assert!(p.label_changed());
        assert_eq!(p.desired_full.as_deref(), Some("nc:done"));
        assert_eq!(p.prev_full.as_deref(), Some("nc:in-progress"));
        assert_eq!(p.comment_due, Some("done"));
        assert!(!p.is_noop());
    }

    #[test]
    fn pending_removes_the_label_on_a_merged_task() {
        let mut t = task(TaskStatus::Done);
        t.merged = true;
        t.issue_synced_label = Some("nc:done".into());
        t.issue_comment_marker = Some("done".into());
        let p = pending_work(&t, "nc:");
        assert!(
            p.label_changed(),
            "None != Some(nc:done) is a change (removal)"
        );
        assert_eq!(p.desired_full, None);
        assert_eq!(p.prev_full.as_deref(), Some("nc:done"));
        assert_eq!(p.comment_due, None);
    }

    #[test]
    fn pending_honors_a_remapped_prefix() {
        let p = pending_work(&task(TaskStatus::Backlog), "status/");
        assert_eq!(p.desired_full.as_deref(), Some("status/queued"));
    }

    #[test]
    fn pending_done_is_noop_once_fully_synced() {
        let mut t = task(TaskStatus::Done);
        t.issue_synced_label = Some("nc:done".into());
        t.issue_comment_marker = Some("done".into());
        assert!(pending_work(&t, "nc:").is_noop());
    }
}
