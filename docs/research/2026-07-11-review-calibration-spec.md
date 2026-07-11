# Spec: Review calibration (verdict clamp + corroboration + trusted posting)

**Date:** 2026-07-11
**Status:** decided (grilled 2026-07-11) — build spec; **target v0.4** (roadmap §6), core buildable now
**Roadmap:** `docs/research/2026-07-11-roadmap-v0.3-v0.5.md` §6 "Review calibration + structured outputs".
**Depends (for tuning, not for the core):** T9 E2E measurement harness (#150) — so the rubric/thresholds can be tuned against real-run data.

## Problem (real-run evidence)

The AI PR reviewer produces **11–28 low-dominated findings per review, and ZERO have ever
been posted** — the reviewer isn't trusted at current noise. Corroboration never fires
(`0/187` real findings ever corroborated) because dedup is exact-fingerprint. The model
freely chooses the merge verdict with no mechanical floor, so a miscalibrated "ready" on a
high-severity finding could slip through. This is governed autonomy failing at its most
visible surface: the reviewer everyone ignores.

## Locked decisions (grill, 2026-07-11)

1. **Verdict = CLAMP.** The model still proposes the merge verdict, but it is mechanically
   CLAMPED to a band derived from the calibrated finding severities. The model picks WITHIN
   the allowed band; a choice outside the band is clamped to the nearest boundary. (Rejected:
   fully-mechanical derivation — loses model nuance; and no-clamp — no governable guarantee.)
2. **Rank-only, keep everything.** ALL findings are kept and sorted by severity +
   corroboration. **No per-lens budget, no suppression, no demotion of lows from the review
   list.** (User explicitly rejected capping/suppression — transparency over brevity.) Noise
   is handled by ranking + corroboration + the clamp, never by hiding findings.
3. **Corroboration = fuzzy-match → rank boost + badge.** Add fuzzy cross-lens matching so
   `corroboratedBy` actually fires; a finding surfaced by 2+ lenses sorts higher and shows an
   "N lenses agree" badge. Corroboration drives RANKING + display ONLY — it does **not** change
   severity or the clamp (severity stays meaning-preserving). (Rejected: severity-bump — over-blocks.)
4. **Posting = pre-fill + human always confirms.** The post dialog opens PRE-FILLED with the
   clamped verdict and PRE-SELECTED findings (high/medium/corroborated as inline comments; lows
   demoted into the review BODY note), the human reviews/edits/posts. The human gate is ALWAYS
   required — it never auto-posts. Kills the from-scratch friction behind "zero posted" while
   keeping the absolute governed-autonomy gate. (Rejected: opt-in auto-post — relaxes the gate.)

## Mechanism

### The clamp
`clampVerdict(modelVerdict, findings) -> MergeVerdict`, a pure function over the calibrated
severities. Given the unified `ReviewSeverity` scale (shared with Insight, low→high), the
WORST finding severity sets a `[floor, ceiling]` band over the four `MergeVerdict` values
(`ready < merge_with_changes < needs_revision < blocked`):

| Worst finding severity present | Allowed band |
|---|---|
| critical (top of scale) | `blocked` only |
| high | `needs_revision`‥`blocked` (floor = needs_revision) |
| medium | `merge_with_changes`‥`needs_revision` |
| low / info only | `ready`‥`merge_with_changes` (ceiling = merge_with_changes — never needs_revision/blocked) |
| no findings | `ready` |

`clampVerdict` returns the model's verdict if it's inside the band, else the nearest boundary
(and records that it was clamped + why, for `verdictReasoning` transparency). Pure + unit-testable.
Map the exact `ReviewSeverity` enum values to these buckets when implementing (read the enum).

### Corroboration (fuzzy)
Replace/augment the exact-fingerprint cross-lens dedup with a **fuzzy** match: two findings from
DIFFERENT lenses corroborate when they share the same file AND their normalized titles are
similar above a threshold (token-set / trigram similarity — pick one, tune later against T9 data).
On a match: keep the higher-severity instance, union the lenses into `corroboratedBy` (the field
already exists on `ReviewFindingSchema`), and do NOT drop the corroborating signal. Corroboration
does not merge findings from the SAME lens (that's ordinary dedup).

### Ranking (all findings kept)
Sort: `severity desc → corroboration count desc → lens order`. No cap. The UI renders the full
ranked list; corroborated rows carry an "N lenses agree" badge.

### Trusted posting (pre-fill)
The post ConfirmDialog opens with: verdict = the clamped verdict (pre-filled, editable);
inline comments = pre-selected high + medium + any corroborated findings that carry a valid diff
anchor (reuse T10 #196's diff-anchor validation — un-anchorable ones demote to the body); the body
note carries the lows + any demoted findings. Human edits + confirms; never auto-posts.

### Fail-visible extras
- **Validator-drop visibility.** The adversarial validator that drops findings must surface WHAT
  it dropped — a collapsed "dropped by validator (N)" section — so a silently-swallowed real
  finding is visible. Additive count on the completed event / run.
- **Structured outputs.** Port the proven `outputFormat` recipe to the pr-review finding + verdict
  passes so severity + verdict come back as validated JSON (not prose-parsed) — the reliability
  substrate the clamp depends on. (Roadmap: also port to issue-triage/insight/harness.)
- **Cost lever (optional / follow-up).** The PR diff is sent ~12×/run (~$12). Dedupe the diff
  context across lens passes (send once, reference) — a cost win, not a calibration requirement;
  can be a fast-follow.

## Contracts (additive)
- `corroboratedBy` already exists on `ReviewFindingSchema` — now actually populated.
- `MergeVerdict` unchanged; the clamp is a finalize-time transform, and `verdictReasoning` notes
  any clamp. Optionally add a `verdictClamped: boolean` / `droppedByValidator: number` additive
  field to the completed event for UI honesty.
- No migration: older on-disk runs load unchanged (empty `corroboratedBy`, absent clamp note).

## Build slices (v0.4)
1. **Clamp + structured outputs** — `clampVerdict` pure fn wired into the verdict finalize;
   port `outputFormat` to the finding + verdict passes; severity rubric tightened in the prompts.
2. **Fuzzy corroboration + ranking** — fuzzy cross-lens matcher populating `corroboratedBy`;
   rank function; "N lenses agree" badge in the findings grid.
3. **Trusted posting + validator-drop visibility** — pre-fill the post dialog (clamped verdict +
   pre-selected inline/body split, reusing T10 diff-anchor validation); surface validator drops.

## Sequencing note
The CORE (clamp, fuzzy corroboration, pre-fill posting) is buildable now and doesn't need
measurement. What genuinely wants T9's E2E harness first is TUNING — the severity rubric
thresholds and the fuzzy-similarity cutoff — so land the mechanism, then calibrate the constants
against real-run data. Roadmap sequences the whole item to v0.4 for this reason.

## How to verify
- `clampVerdict` unit tests: each severity bucket clamps an out-of-band model verdict to the right
  boundary; in-band verdicts pass through; the clamp reason is recorded.
- Fuzzy corroboration tests: two near-duplicate cross-lens findings corroborate (populate
  `corroboratedBy`); same-lens near-dupes don't; dissimilar findings stay separate.
- Posting: the dialog pre-fills the clamped verdict + the inline/body split; a lows-only review
  never pre-fills needs_revision/blocked; the human gate still fires (no auto-post).
- Real-run: on a live PR review, confirm a high-severity finding forces ≥ needs_revision and that
  corroborated findings rank to the top with the badge.
