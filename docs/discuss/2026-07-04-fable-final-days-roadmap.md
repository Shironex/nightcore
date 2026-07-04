# Idea Discussion: Nightcore roadmap for the final 3 Fable days

**Date:** 2026-07-04
**Skill:** kirei-discuss
**Status:** build (sequenced roadmap below)

## The Idea

Decide how to spend the last ~3 days of Fable 5 access so Nightcore crosses from "feature-complete Automaker successor" to "a control panel the developer actually trusts to drive their OTHER daily repos unattended." Eight candidate investments were on the table: Insight trust, Harness UX, GitHub issue intake, PR-system testing, auto-mode concurrency safety, convert-all-to-worktrees, Scorecard reliability, and a second provider (Codex).

## Why Now

Deadline-driven: 3 days of Fable access remain, and Fable is disproportionately valuable for bug-hunting in complex shipped systems and for hard correctness work. The user confirmed the primary near-term target is driving other daily projects (the GitHub-flow use case), and chose a trust-first split over feature-first.

## Grounded Facts (verified in code during discussion)

1. **Insight "always 7-8 findings" is a hardcoded cap, not a signal.** `packages/engine/src/scans/insight/manager.ts:55` — `MAX_FINDINGS_PER_CATEGORY = 8`, injected as "Return AT MOST 8 findings, highest-impact first". The model both truncates at 8 and gravitates toward ~7-8 on thin material. Same cap in Harness (`harness/manager.ts:61`) and PR-review (`pr-review/manager.ts:75`).
2. **New-vs-known infrastructure is half-built.** `scans/shared/findings.ts` already computes a stable `file | title` fingerprint, and Rust already matches on it for dismissed-history across re-runs. The UI simply never badges findings as new / known / resolved — the presentation layer is the missing piece, not the data model.
3. **No verification pass exists for Insight/Scorecard findings** (pipeline is model → parse → ground refs → dedup → UI). Ironically `pr-review/validator.ts` already demonstrates the pattern in a sibling.
4. **Provider seam:** `apps/desktop/src-tauri/src/provider/mod.rs:54` has a clean transport-level `Provider` trait (start_session / interrupt / set_permission_mode / decide_permission / send_answer / query). But everything beneath it is Claude-Agent-SDK-shaped: tool names in scan presets, canUseTool/PreToolUse permission tiers, AskUserQuestion dialogs, plan mode. A real Codex provider = second sidecar + semantic reconciliation = 1-2 weeks, not 3-day territory.
5. **Auto-mode concurrency fear is confirmed by the code's own design:** auto-commit is gated by `isCommitIsolated` precisely because main-mode `commit_task` does `git add -A` on the shared root; review-state has the same shared-tree exposure. Worktrees are the designed answer.

## Value

Who benefits: the user, directly, every day — Nightcore pointed at client/daily repos with analysis outputs they can act on without second-guessing, and an auto mode that can run 3-concurrent without corrupting commits or reviews.

Success at 1 month: the user runs issue → task → worktree → PR → AI review end-to-end on a real external repo, and Insight re-scans show "3 new, 5 known, 2 resolved" instead of an opaque 7.

Success at 6 months: prompt/model changes are gated by the seeded-defect eval (recall number), so quality regressions are caught mechanically, and a second provider is a bounded implementation job against a documented contract.

## The Roadmap (decided)

### Day 1 — PR system E2E dogfood + fixes (Fable)
The biggest risk concentration: 4 shipped phases, zero real-remote validation, and the user's favorite flow (issue → task → PR → review) sits on top of it. Create a scratch GitHub repo and drive the full arc: create PR → status/finalize/push → AI PR-review scan → post review → address-comments. Fix what breaks. **Timebox rule: PR fixes get one day; non-data-loss bugs found late go to the backlog rather than eating Day 2.**

### Day 2 — Trust layer for the analysis views (Fable)
- **Insight:** make the per-category cap configurable (raise default), or add a "scan again excluding known fingerprints" second pass (loop-until-dry lite); wire the existing fingerprint into UI badges — new / known / resolved-since-last-run; add a verification pass modeled on `pr-review/validator.ts` (adversarial "is this finding real, does the cited code actually have this problem" check before findings reach the UI).
- **Scorecard:** require file:line evidence per reading; run the same commit twice and measure variance as a cheap reliability probe.
- **Seeded-defect eval repo:** small fixture repo with N planted issues (a real bug, a security hole, dead code, a missing test, a stale doc). Run Insight against it, report recall. This converts "are findings valid?" from a feeling into a number and becomes the permanent regression gate for every future prompt/model change. Highest leverage-per-hour item in the whole plan.

### Day 3 — Safe concurrent autonomy (Fable)
- Force worktree-per-task whenever auto mode runs with concurrency > 1 (auto-commit and review isolation both fall out of this).
- Convert-all Insight findings → worktree tasks (the "multi-edit" need collapses into this).
- Stretch, if time remains: issue-intake thin slice — validate a GitHub issue → propose a grounded task, reusing the existing propose→convert sentinel pattern from Decompose/Insight.

### Parallel / Opus-executable (not Fable time)
- **Provider seam audit doc** (~half day, any session): inventory every Claude-specific assumption below the `Provider` trait; write the exact contract a second provider must implement (session lifecycle, permission decisions, tool-name mapping, dialog kinds, streaming events); list the refactors needed to make the engine layer provider-agnostic. Written as an implementation-ready handoff so Opus sessions can execute it after Fable access ends.
- **Harness results restructure**: per-finding What / Why / Evidence (code refs) / Proposed-rule structure; clearer Config→Running→Results narrative. User flagged "can't judge findings" + "flow/layout confusing" + wants more what/why structure; user did NOT flag per-rule apply granularity or cross-repo inference as concerns.
- **Issue intake, full version** (1-2 days, Opus-capable once PR system is verified): issue validation → task → worktree → PR → AI review → address comments. The complete Automaker loop, now on a tested pipeline.

## Cost

- Size: 3 Fable days (sequenced above) + ~2-3 Opus-days of parallel/follow-up work.
- Touches: mostly existing scan-engine code (caps, validator port, fingerprint UI), orchestration (worktree forcing), and one new fixture repo. Issue intake is the only genuinely new surface, and it clones an existing pattern.
- Hidden costs: the eval repo needs occasional upkeep as categories evolve; forced-worktree changes auto-mode behavior (needs a settings note); PR dogfood requires a scratch GitHub remote + gh auth.

## Risks

- **Day 1 overrun:** dogfooding may surface a nest of PR-system bugs. Mitigation: the timebox rule — only data-loss-grade bugs may eat Day 2.
- **Verification pass cost/latency:** a verify agent per finding adds tokens and wall-clock to every scan. Mitigation: verify only medium+ severity, or batch-verify per category.
- **Forced worktrees under auto mode** may surprise on repos with heavy untracked state or build artifacts. Mitigation: surface it in the run config UI, keep it overridable for concurrency=1.
- Load-bearing assumption: **that trust is the adoption blocker.** If after the trust layer the user still doesn't reach for Insight on real repos, the problem is elsewhere (e.g., findings aren't actionable enough) — the eval repo will help distinguish "findings are wrong" from "findings are right but not worth acting on".

## Alternatives Considered

1. **Feature-first (build issue intake now)** — rejected: builds the flagship flow on an untested PR pipeline and leaves the trust problem to rot; every new view inherits it.
2. **Build the Codex provider now** — rejected: 1-2 weeks of work compressed into days it can't fit; the seam audit captures 80% of the future value at ~5% of the cost, and is Opus-executable.
3. **Do nothing / just dogfood** — rejected in part; pure dogfooding would surface the PR bugs (good) but never fixes the finding-cap artifact or the missing verification, which are code changes, not usage discoveries.

## Reversibility

Everything here is a two-way door. The cap change, badges, validator, eval repo, and worktree-forcing are all flag-able or deletable. No data migrations, no public API contracts, no vendor lock-in. That argues for moving fast without further deliberation.

## The Hardest Pushback

"You're adding features to an app whose analysis outputs you yourself don't trust — trust IS the product." The roadmap answers it by putting verification, baseline-diff badging, and a measurable recall number ahead of any new feature, and by refusing to build issue-intake on an untested PR pipeline. The second-hardest pushback — "3 days will not survive contact with Day 1's bug findings" — is answered by the explicit timebox rule.

## Recommendation

**Build, in the sequence above.** The plan spends the scarce Fable capacity where the strongest model has the highest marginal value (adversarial dogfooding of a 4-phase system, correctness of concurrent auto-commit) and pushes everything Opus-capable (seam audit, Harness restructure, full issue intake) into parallel or follow-up work. Trust work is not a detour from the "other daily projects" goal — it is the prerequisite for it, because nobody points an untrusted analyzer at a client repo.

## Next Step

Start Day 1: create a scratch GitHub repo and dogfood the PR arc end-to-end (`create PR → finalize/push → AI review scan → address comments`), fixing as you go. In parallel, hand the provider seam audit to an Opus session — its deliverable is the contract doc described above.

## Open Questions

- Should the verification pass gate findings out entirely or just annotate confidence? (Suggest: annotate first, gate later once eval-repo recall confirms the validator isn't killing true positives.)
- Issue intake scope: validation-only first (issue → verdict + proposed task), or straight to auto-PR? (Suggest: validation-only thin slice; the rest is composition of existing pieces.)
- Does Scorecard need its own eval fixtures, or does the Insight seeded-defect repo cover both? (Likely shareable.)
