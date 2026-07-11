//! GitHub two-way issue sync — the WRITEBACK engine (#97, spec §3).
//!
//! Sibling of `workflow/issue_triage/` (the intake half). Projects a linked task's
//! Nightcore lifecycle onto its GitHub issue: an `nc:*` status label kept in sync
//! (idempotent, anti-churn) plus a terminal comment at convert/done/failed, all through
//! the hardened `gh` seam (`git/gh.rs`) and — from the command side — the per-root mutation
//! lease. The issue closes NATIVELY on PR merge via `Closes #N` (PR 3), so nothing here
//! ever issues an explicit close.
//!
//! Split by concern, each a flat sibling under this thin manifest (the house module shape):
//! - [`labels`] — the 5-label `nc:*` vocabulary + the three idempotent `gh api` REST
//!   primitives (`ensure`/`add`/`remove`) + the ensure-cache (§3.1 / §3.3).
//! - [`transition`] — the PURE §3.2 table: `desired_label` / `comment_key` / the
//!   [`pending_work`] delta the command uses to early-out with zero `gh` calls.
//! - [`comment`] — the deterministic, structured-only terminal comment builder (§3.4).
//! - [`degrade`] — the writeback orchestrator + the permission-degradation ladder + the
//!   per-project downgrade cache (§3.6 step 6, §3.8).
//! - [`state`] — the projection-IN half (#97 PR 4, §5): the upstream-close/reopen poll
//!   (open-set diff + batched `gh api graphql` state confirm, READ-ONLY) that drives the
//!   "closed upstream" chip, plus the chip's `gh issue view --web` open action.
//!
//! The `sync_issue_status` command that ties the writeback pieces together (settings
//! gate, project guard, lease, stamp, emit) and the read-only `poll_issue_states` /
//! `open_issue_in_browser` commands live in `sidecar/issue_sync.rs`; the web observers
//! that fire them are PR 3 (writeback) and PR 4 (focus poll).

mod comment;
mod degrade;
mod labels;
mod state;
mod transition;

pub(crate) use degrade::apply_writeback;
pub(crate) use state::{open_issue_in_browser, project_issue_states};
pub(crate) use transition::pending_work;
