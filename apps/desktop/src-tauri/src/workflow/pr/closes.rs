//! GitHub two-way sync (#97, §3.5): the closing-keyword body helper. Appends
//! `Closes #N` to a PR body so a merge auto-closes the referenced issue natively
//! (Nightcore never issues an explicit close). Pure + idempotent — shared by the
//! create path (defensive) and the draft path (the visible pre-fill).

/// GitHub two-way sync (#97, §3.5): the closing keywords GitHub recognizes in a PR
/// body to auto-close a referenced issue on merge. Detection is case-insensitive, so
/// these are matched lowercased.
const CLOSING_KEYWORDS: [&str; 9] = [
    "close", "closes", "closed", "fix", "fixes", "fixed", "resolve", "resolves", "resolved",
];

/// Append `Closes #N` to a PR body unless it already references closing issue `n`
/// via any GitHub keyword (`close(s|d)` / `fix(es|ed)` / `resolve(s|d)` + `#n`,
/// case-insensitive). Pure + idempotent (§3.5): an issue-linked task's PR gets the
/// keyword that auto-closes the issue on merge, without duplicating one the dialog
/// pre-fill or the user already typed. Reused by the create path (defensive) and the
/// draft path (the visible pre-fill).
pub(crate) fn ensure_closes_keyword(body: &str, n: u64) -> String {
    if body_closes_issue(body, n) {
        return body.to_string();
    }
    let trimmed = body.trim_end();
    if trimmed.is_empty() {
        return format!("Closes #{n}");
    }
    format!("{trimmed}\n\nCloses #{n}")
}

/// Whether `body` already closes issue `n` — a closing keyword immediately before a
/// `#n` reference (case-insensitive). Guards against a partial numeric match (`#12`
/// inside `#123`) and requires the keyword to be a whole word, so a bare `#12` or an
/// unrelated word ending in a keyword (`prefixes #12`) does not count as closing.
fn body_closes_issue(body: &str, n: u64) -> bool {
    let lower = body.to_lowercase();
    let token = format!("#{n}");
    let mut from = 0;
    while let Some(rel) = lower[from..].find(&token) {
        let at = from + rel;
        let after = at + token.len();
        // Reject `#12` when the real reference is `#123` (a longer number).
        let next_is_digit = lower[after..]
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_digit());
        if !next_is_digit && preceding_keyword(&lower[..at]) {
            return true;
        }
        from = after;
    }
    false
}

/// Whether the text immediately before a `#n` reference ends in a closing keyword
/// (a whole word). The keyword may be followed by spaces and an optional colon
/// (`Closes: #12`) before the reference — the shape GitHub accepts.
fn preceding_keyword(before: &str) -> bool {
    let head = before.trim_end_matches([' ', '\t', ':']);
    CLOSING_KEYWORDS.iter().any(|kw| {
        head.len() >= kw.len() && head.ends_with(kw) && {
            let start = head.len() - kw.len();
            // Whole-word: the char before the keyword must be a boundary, so
            // `prefixes` does not match `fixes`.
            start == 0 || !head.as_bytes()[start - 1].is_ascii_alphanumeric()
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_closes_keyword_appends_when_absent() {
        // A plain body gains a `Closes #N` line separated by a blank line.
        let out = ensure_closes_keyword("## Summary\n- did work", 42);
        assert_eq!(out, "## Summary\n- did work\n\nCloses #42");

        // An empty body becomes just the keyword (no leading blank lines).
        assert_eq!(ensure_closes_keyword("", 7), "Closes #7");
        assert_eq!(ensure_closes_keyword("   \n\n", 7), "Closes #7");

        // Trailing whitespace is trimmed before the keyword is appended.
        assert_eq!(ensure_closes_keyword("body\n\n", 3), "body\n\nCloses #3");
    }

    #[test]
    fn ensure_closes_keyword_is_idempotent_across_keywords_and_case() {
        // Every recognized keyword + case variant already-present ⇒ no-op.
        for present in [
            "Closes #12",
            "closes #12",
            "CLOSES #12",
            "Fixes #12",
            "fixed #12",
            "Resolves #12",
            "resolve #12",
            "Closed #12",
            "Closes: #12",
            "This PR closes #12 and adds tests",
        ] {
            assert_eq!(
                ensure_closes_keyword(present, 12),
                present,
                "already-closing body is untouched: {present:?}"
            );
        }
    }

    #[test]
    fn ensure_closes_keyword_guards_partial_numbers_and_bare_refs() {
        // `#12` inside `#123` is NOT a close of issue 12 — the keyword still appends.
        let out = ensure_closes_keyword("Closes #123", 12);
        assert_eq!(out, "Closes #123\n\nCloses #12");

        // A bare `#12` with no closing keyword before it does not count.
        let out = ensure_closes_keyword("see #12 for context", 12);
        assert_eq!(out, "see #12 for context\n\nCloses #12");

        // A word that merely ENDS in a keyword (`prefixes`) is not a whole-word match.
        let out = ensure_closes_keyword("prefixes #12", 12);
        assert_eq!(out, "prefixes #12\n\nCloses #12");
    }
}
