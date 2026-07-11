//! Review-post SURVIVABILITY: validate each inline comment's `(path, line)` anchor
//! against the PR's CURRENT diff, DEMOTE the ones that don't anchor into the review body
//! (never drop them, never fail the whole post), and note when the PR head moved since
//! the review was computed. Pure + unit-testable; the blocking layer in [`super::post`]
//! feeds it the diff + head SHAs it fetched via the `gh` seam.
//!
//! Why: GitHub's `POST …/reviews` validates every inline comment's `line` against the
//! diff and 422s the ENTIRE review (body + all comments) on a single anchor outside the
//! diff — so one stale/out-of-diff finding would sink the whole post. We
//! UNDER-approximate the valid-anchor set (only RIGHT-side context + added lines — the
//! anchors GitHub accepts for a default-side inline review comment) so a KEPT comment
//! never 422s; a comment we cannot prove anchorable is demoted to text rather than risked
//! inline.
//!
//! Trust: the review body + our finding text are Nightcore-authored (TRUSTED). The DIFF
//! is FOREIGN — parsed only for line arithmetic; NO raw diff text is ever echoed into the
//! posted body (only our own finding text + `path:line` refs + the two head SHAs).

use std::collections::{HashMap, HashSet};

use super::post::InlineComment;

/// The PR head advanced between when a review was computed and when it is posted. The
/// finding line numbers were computed against `reviewed`; the freshly-fetched diff (and
/// thus the re-validated anchors) reflect `current`. Surfaced as an honest note in the
/// posted body.
pub(super) struct StaleHead {
    pub reviewed: String,
    pub current: String,
}

/// A review made survivable: the inline `comments` that anchor cleanly on the CURRENT
/// diff, plus the `body` carrying the original summary followed by any demoted findings
/// and a stale-head note. Hand straight to [`super::post::post_review_with`].
pub(super) struct PreparedReview {
    pub comments: Vec<InlineComment>,
    pub body: String,
}

/// Make a review post SURVIVE GitHub's all-or-nothing anchor validation: partition
/// `comments` into those that anchor on the CURRENT `diff` vs. those that don't, keep only
/// the anchorable ones inline, DEMOTE the rest into `body` as a text section (no finding
/// is dropped, no out-of-diff anchor is left to 422 the whole post), and prepend a
/// stale-head note when `reviewed_head` (the head the review saw) differs from
/// `current_head` (the head the diff reflects). Pure — the caller fetched `diff` +
/// `current_head` via the `gh` seam. Re-anchoring is implicit: validating against the
/// freshly-fetched `diff` IS re-anchoring against the current head, so a moved head can
/// never leave a comment on the wrong line — it either still anchors or demotes.
pub(super) fn prepare_survivable_review(
    body: &str,
    comments: &[InlineComment],
    diff: &str,
    reviewed_head: Option<&str>,
    current_head: &str,
) -> PreparedReview {
    let valid = parse_valid_anchors(diff);
    let (anchorable, demoted) = partition_comments(comments, &valid);
    let stale = stale_head(reviewed_head, current_head);
    let body = compose_body(body, &demoted, stale.as_ref());
    PreparedReview {
        comments: anchorable,
        body,
    }
}

/// Parse a PR's unified diff into the valid RIGHT-side inline-anchor line numbers per
/// changed file: for each file, the 1-based NEW-file line numbers that appear in a hunk
/// as a context (` `) or added (`+`) line — exactly the lines GitHub accepts for a
/// default-side (`RIGHT`) inline review comment. Removed (`-`) lines are LEFT-side only
/// and never included; deleted files (`+++ /dev/null`) contribute no anchors. Under-
/// approximating (a rename we can't map, a C-quoted path) merely demotes a comment to the
/// body — the safe direction — never a false anchor that would 422.
pub(super) fn parse_valid_anchors(diff: &str) -> HashMap<String, HashSet<u64>> {
    let mut anchors: HashMap<String, HashSet<u64>> = HashMap::new();
    let mut current_path: Option<String> = None;
    let mut new_line: u64 = 0;
    let mut in_hunk = false;

    for line in diff.lines() {
        // A new file section resets the path + hunk state (`diff --git a/… b/…`).
        if line.starts_with("diff --git ") {
            current_path = None;
            in_hunk = false;
            continue;
        }
        // A hunk header (`@@ -a,b +c,d @@ …`) — a column-0 `@@ ` is unambiguous (hunk-body
        // lines are always prefixed by a space/`+`/`-`). Parse the new-side start.
        if let Some(start) = parse_hunk_new_start(line) {
            new_line = start;
            in_hunk = true;
            continue;
        }
        if !in_hunk {
            // File-header region: capture the new path from `+++ b/<path>` (or clear it on
            // `+++ /dev/null`, a deletion — no RIGHT-side anchors). The `--- …` + index /
            // mode / rename lines are ignored.
            if let Some(rest) = line.strip_prefix("+++ ") {
                current_path = parse_new_path(rest);
            }
            continue;
        }
        // Hunk body: advance the new-side counter and record the anchorable lines.
        match line.as_bytes().first().copied() {
            // Added or context line: anchorable on the RIGHT side; advances the new side.
            Some(b'+') | Some(b' ') | None => {
                if let Some(path) = &current_path {
                    anchors.entry(path.clone()).or_default().insert(new_line);
                }
                new_line += 1;
            }
            // A removed line is LEFT-side only: no anchor, no new-side advance.
            Some(b'-') => {}
            // `\ No newline at end of file` — metadata, not a line.
            Some(b'\\') => {}
            // Anything else inside a hunk is anomalous; ignore it defensively.
            Some(_) => {}
        }
    }
    anchors
}

/// Parse a unified-diff hunk header (`@@ -oldStart[,oldCount] +newStart[,newCount] @@ …`)
/// and return `newStart` — the 1-based first NEW-file line the hunk covers. `None` for a
/// non-hunk line so the caller falls through. Only a column-0 `@@ ` is a header (hunk-body
/// lines are always prefixed), so this never misfires on content.
fn parse_hunk_new_start(line: &str) -> Option<u64> {
    let rest = line.strip_prefix("@@ ")?;
    // rest = "-a,b +c,d @@ …" — find the `+` group and read its start before any `,`.
    let plus = rest.split_whitespace().find(|tok| tok.starts_with('+'))?;
    plus[1..].split(',').next()?.parse::<u64>().ok()
}

/// Extract the repo-relative new-file path from a `+++ ` header value: strip the git `b/`
/// prefix, cut any trailing tab metadata, and map `/dev/null` (a deletion) to `None` (no
/// RIGHT-side anchors). NOT a general git-quote decoder — a C-quoted path (rare:
/// non-ASCII / space names) simply won't match our finding's path and its comments demote
/// to the body, which is the safe direction.
fn parse_new_path(rest: &str) -> Option<String> {
    let raw = rest.split('\t').next().unwrap_or(rest).trim();
    if raw == "/dev/null" {
        return None;
    }
    let path = raw.strip_prefix("b/").unwrap_or(raw);
    (!path.is_empty()).then(|| path.to_string())
}

/// Split `comments` into `(anchorable, demoted)`: a comment is anchorable when its file is
/// in the diff AND its `line` is a valid RIGHT-side anchor there. Order-preserving; every
/// input lands in exactly one bucket (nothing dropped).
fn partition_comments(
    comments: &[InlineComment],
    valid: &HashMap<String, HashSet<u64>>,
) -> (Vec<InlineComment>, Vec<InlineComment>) {
    let mut anchorable = Vec::new();
    let mut demoted = Vec::new();
    for c in comments {
        if valid
            .get(&c.path)
            .is_some_and(|lines| lines.contains(&c.line))
        {
            anchorable.push(c.clone());
        } else {
            demoted.push(c.clone());
        }
    }
    (anchorable, demoted)
}

/// A stale-head record when the reviewed head is known, non-empty, and differs from the
/// current head. `None` when there is no reviewed head to compare (an older run, or a post
/// composed outside a stored run) or the heads match.
fn stale_head(reviewed_head: Option<&str>, current_head: &str) -> Option<StaleHead> {
    let reviewed = reviewed_head?.trim();
    let current = current_head.trim();
    if reviewed.is_empty() || current.is_empty() || reviewed == current {
        return None;
    }
    Some(StaleHead {
        reviewed: reviewed.to_string(),
        current: current.to_string(),
    })
}

/// Compose the posted review body: the original summary, then (when the head moved) a
/// stale-head note, then (when any finding was demoted) a "couldn't be anchored inline"
/// section listing `path:line — message` for each. ONLY our own finding text + path refs +
/// the two head SHAs are emitted — never raw foreign diff text. Returns `body` unchanged
/// when nothing was demoted and the head is current.
fn compose_body(body: &str, demoted: &[InlineComment], stale: Option<&StaleHead>) -> String {
    if demoted.is_empty() && stale.is_none() {
        return body.to_string();
    }
    let mut out = body.trim_end().to_string();
    if let Some(s) = stale {
        out.push_str("\n\n---\n\n");
        out.push_str(&format!(
            "> **Note — the PR head advanced since this review was computed** \
             (reviewed `{}`, now `{}`). Inline comment anchors were re-validated against \
             the current diff.",
            short_sha(&s.reviewed),
            short_sha(&s.current),
        ));
    }
    if !demoted.is_empty() {
        out.push_str("\n\n---\n\n");
        out.push_str(
            "**Findings that couldn't be anchored inline**\n\n\
             These reference lines that are not part of the PR's current diff (the code \
             moved, or the line is outside a changed hunk), so they're listed here rather \
             than dropped:\n",
        );
        for c in demoted {
            out.push_str(&format!("\n- `{}:{}` — {}", c.path, c.line, c.body.trim()));
        }
    }
    out
}

/// A short, display-friendly commit SHA (first 12 chars) for the stale-head note. The
/// input is a GitHub-provided hex OID (never attacker text), so this is presentation-only.
fn short_sha(sha: &str) -> String {
    sha.chars().take(12).collect()
}
