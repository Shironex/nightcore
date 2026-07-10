# Research: Scan-family views — product/UX + architecture rethink

**Date:** 2026-07-10
**Agent:** kirei
**Status:** complete (research only — no code changes)

## Problem

The user (Shirone) says the scan-family views "kinda have the same flow" (Config →
Running → Results) and wants a rethink. The named set was Insight, Harness, Readiness
Scorecard ("scoreboard"), Structure-Lock Gauntlet, Pre-flight Context Pack, Custom
Lint-Plugin Generator, and the AI PR-review scan. This document maps the actual code
across all four tiers, quantifies the duplication, assesses the Scorecard/Insight/Harness
overlap, evaluates the user's proposed Harness PROPOSE/ENFORCE split, and proposes
restructure options with a recommendation.

## Root finding (the reframe)

**Of the 7 features the user named, only FOUR are actually parallel "scan views," and the
real count of look-alike wizards in the sidebar is FIVE — not seven.** Three of the named
features are already correctly placed *outside* the scan-view pattern; a fifth scan view
(Issue Triage) the user did not name is the one that most inflates the parallelism.

The genuinely-parallel scan views live in the sidebar **tools** group
(`apps/web/src/components/app/AppShell/nav.constants.tsx:30-64`):

1. **Insight** — find→fix; read-only category passes → severity-ranked `Finding` → convert-to-task
2. **Scorecard** — grade→harden; dimension passes → A–F `ScorecardReading` → "Harden this"
3. **Harness** — audit→propose→enforce; convention passes → `ConventionFinding` + synthesis → `ProposedArtifact`/`HarnessProposal` + Policy manifest
4. **PR Review** (`prreview`) — concurrent per-PR reviews (NOT a single-run lifecycle) → review findings → post to GitHub
5. **Issue Triage** (`issues`) — the 5th sibling the user didn't name; validate GitHub issues → convert/post

The three named features that are **NOT** standalone scan views:

- **Custom Lint-Plugin Generator** — folded into Harness as an artifact kind
  (`ArtifactKindSchema` `custom-lint-plugin`/`eslint-plugin-file`, `packages/contracts/src/harness.ts:149-161`);
  renders through `HarnessProposalList`/`ArtifactDetailPanel`. No view of its own.
- **Structure-Lock Gauntlet** — a per-task deterministic gate in the verify state machine
  (`apps/desktop/src-tauri/src/workflow/gauntlet_project/mod.rs:1`), surfaced in the board
  TaskDetail drawer via `board/GauntletResults`, not a nav route.
- **Pre-flight Context Pack** — a Nightcore-owned `.nightcore/context.md` Constitution injected
  into `appendSystemPrompt` (`apps/desktop/src-tauri/src/analysis/context.rs:1`), edited from a
  Settings card (`components/settings/ConstitutionCard`). Not a scan view.

So the user's "seven parallel wizards" instinct is right in spirit but the fix is: the
problem is **5 real scan views + one overloaded Harness**, and the three non-views are
already living where they belong (board / settings / inside-Harness). This matters because
a rethink that tries to "unify seven wizards" would drag correctly-placed runtime gates
(Gauntlet) and settings artifacts (Context Pack) into a wizard mold they don't fit.

## Evidence

### Shared core already extracted (the "same flow" is deliberate, not accidental)

The five views converged on a shared run spine at every tier — this is why they feel
identical:

- **Web UI primitives:** `RunLifecycleShell` (`apps/web/src/components/ui/RunLifecycleShell/RunLifecycleShell.tsx:21`
  — owns the CONFIGURE/RUNNING/RESULTS frame), `RunProgress`, `CodeBlock`.
- **Web run state machine:** `apps/web/src/lib/useScanRun.ts` (256 LOC) — the single-run lifecycle
  (list/subscribe/reconcile/optimistic-start with a re-entrancy guard). Each family injects only
  its `streamFromRun` / bridge seams / `onEvent`. Its own header comment: "hoisted out of the four
  structurally-identical scan siblings … Each `*View.hooks.ts` had re-implemented the exact same
  machinery."
- **Web fold/results helpers:** `apps/web/src/lib/scan-run/{lifecycle,fold,results}.ts` — `deriveRunPhase`,
  `seedStepState`, `settleStepState`, `buildLensTabs`, `normalizeLocation`, `patchStreamItem`,
  `scanSkeletonCount`. Doc comments repeatedly say "cloned byte-for-byte across all four scan
  `*View.hooks.ts`" (`lifecycle.ts:18-31`) and "cloned across insight ×1, scorecard ×4, harness ×1"
  (`results.ts:29-31`).
- **Web shared hooks:** `lib/useScanResultsView.ts`, `lib/useScanItemActions.ts`, `lib/useRunConfig.ts`.
- **Engine orchestrator:** `packages/engine/src/scans/shared/scan-manager.ts:206` — abstract
  `ScanManager` (~630 LOC) owns the whole started→prepare→fan-out→finalize skeleton, the bounded pool,
  per-item corrective retry, usage accumulation, cancel/crash handling. Subclasses inject ~12 hooks
  (`items`/`preset`/`sessionConfig`/`buildPrompt`/`parse`/`ground`/`finalize`/…). Header: "This replaces
  three structurally-identical manager classes."
- **Rust store:** `apps/desktop/src-tauri/src/store/run_store.rs:1` — generic `RunStore<R>`; each feature's
  store is a type alias; disk-first CRUD, `MAX_RUNS=50` prune, boot reaper all in one audited place.
- **Rust command layer:** `scan_lifecycle_commands!` macro (`apps/desktop/src-tauri/src/sidecar/scan.rs:61`)
  stamps list/get/delete/cancel Tauri commands per family; shared `ScanTelemetry`/`wire_str`/`failure_reason`
  finalizer helpers (`scan.rs:128-169`).
- **Contracts:** `packages/contracts/src/event-fragments.ts` (`runTotals`/`scanFailure`/`TokenUsageSchema`)
  shared across every `*-started`/`*-item-completed`/`*-completed`/`*-failed` family.
- **Lint rail:** `tools/lint-meta/rules/scan-family-parity.ts:31-39` enrols `insight`/`harness`/`scorecard`/
  `issues` (single-run) + `prreview` (concurrent) and CI-fails any new `components/<x>/<x>-stream.ts` that
  isn't consciously enrolled or doesn't build on the shared primitives.

### The residual duplication (what the shared core did NOT remove)

The shared core removed the **algorithm** (orchestration, lifecycle, CRUD, folding). It did
**not** remove the **shape**: every sibling still hand-clones a parallel set of per-family
types, event families, folders, renderers, stores, and nav wiring.

Per-sibling footprint (non-test/story), measured:

| Sibling | contract LOC | web files / LOC | Rust store LOC | Rust sidecar LOC |
|---|---|---|---|---|
| insight | 163 | 26 / 1495 | 798 | 569 |
| scorecard | 153 | 20 / 1270 | 577 | 408 |
| harness | 422 | 64 / 4491 | ~1337 (`harness/*`) | ~1256 (`harness/*` + `apply.rs`) |
| issue-triage | 318 | 36 / 2229 | 516 | ~575 (`issue_triage/*`) |
| pr-review | 165 | 63 / 7803 | 771 | 648 |

Each contract re-declares its own item enum (`FindingCategory` / `ScorecardDimension` /
`ConventionCategory`), its own finding schema, and its own five-event family. Each web folder
re-declares its own `*View` + `*View.hooks` + data hook + `*-stream.ts` fold + Grid + DetailPanel +
RunControls + CategoryTabs + constants + types — structurally identical to its siblings' (the
lifecycle helpers even note the per-family re-declaration of `CategoryProgress`/`DimensionProgress`/
`LensProgress`, `lifecycle.ts:53-59`).

**Cost of an 8th sibling today:** even with the shared core, a new sibling is a new contract file
(~150-420 LOC), an engine `ScanManager` subclass + presets + parse/ground (~300-600 LOC), a Rust
store (~500-800 LOC), a Rust sidecar handler (~400-600 LOC), a web folder (~15-25 files / ~1200-2000
LOC), plus AppView/nav enrolment, `scan-family-parity` enrolment, and zod↔Rust↔ts-rs codegen wiring.
Ballpark **~2,500-4,000 LOC across ~40-70 files touching all four tiers.** The parity is disciplined,
but the marginal cost is still a *parallel wizard*, not a *config entry*.

### Overlap: Scorecard ≈ Insight-with-a-rubric (confirmed, explicit)

`packages/contracts/src/scorecard.ts:6-23` literally calls Scorecard "the Profile twin of Insight,"
and `ScorecardReadingSchema` (`scorecard.ts:71`) "the Scorecard's analogue of a `Finding`, mirroring
its flat, codegen-friendly shape MINUS severity/effort … PLUS `dimension`, `grade`, `findings`." The
`scorecard-*` events are 1:1 with `analysis-*`. The build spec (`docs/research/2026-06-26-production-harness-features-build-spec.md:30-32`)
calls it "~80% a structural copy" of Insight with three real divergences: grade not severity;
dimension-dispatch (skill/kirei "harden" scanners) not a fixed Claude pass; no dismiss/cross-run dedup.
Everything else — grounding, streaming, store CRUD, lifecycle, convert-to-task — is shared.

### Overlap: Harness audit half ≈ Insight-scoped-to-conventions (confirmed)

`ConventionFindingSchema` (`packages/contracts/src/harness.ts:52`) "mirrors Insight's `Finding` but
repo-pattern shaped: `evidence` is a LIST of anchors … and `kind` separates an observed rule from a
missing best practice" (`kind: 'convention' | 'gap'`, `harness.ts:42`). Same category-pass fan-out,
same grounding, same grid/detail shape. The genuine divergence is entirely in the **tail**: a
deterministic `RepoProfile` pre-pass (`harness.ts:119`), a **synthesis** pass that turns findings into
applyable `ProposedArtifact`s (`harness.ts:176`), the security-critical `apply_harness_artifact` write
path (`apps/desktop/src-tauri/src/sidecar/harness/apply.rs`), and a runtime `HarnessPolicy` manifest
(`harness.ts:265`). So **Harness = an Insight-shaped audit + a generate/enforce back-half the others
lack.** The Harness RESULTS screen already exposes this as four section tabs — Conventions / Proposals
/ Artifacts / Policy (`apps/web/src/components/harness/HarnessView/HarnessView.tsx:174-199`).

### Where the five genuinely differ (do not over-merge)

- Insight: dismiss + cross-run fingerprint carry-forward; `convert_finding_to_task`.
- Scorecard: A–F rubric, skill dispatch, "harden this," no dismiss.
- Harness: `RepoProfile` detection, synthesis→artifacts, hardened apply write path, Policy runtime,
  gauntlet-check arming.
- PR Review: **concurrent** multi-run (no single `useScanRun` — hence `CONCURRENT_FAMILIES` in the lint
  rule, `scan-family-parity.ts:39`), diff-centric grounding, `gh` review posting, own-PR guard, fix runner.
- Issue Triage: GitHub issue list, validate/triage, post comment; list-driven, not fan-out.

## Evaluation of the user's Harness PROPOSE / ENFORCE split

The split maps almost exactly onto Harness's existing four RESULTS sections:

- **PROPOSE mode** ≈ the *Proposals* + *Artifacts* sections + `RepoProfile` detection. The profile
  already carries `hasLintMeta` / `hasEslintFlatConfig` / `hasAgentDocs` / `existingPlugins`
  (`harness.ts:128-136`), which is exactly the signal needed to "propose extensions in the existing
  idiom" for a repo that already has tooling (build spec §2 confirms this path).
- **ENFORCE/GAPS mode** ≈ the *Conventions* section (`ConventionFinding.kind: 'gap'` = missing best
  practice / not-followed; `'convention'` = codify+enforce) + the *Policy* section (runtime
  `HarnessPolicy`) + the Structure-Lock Gauntlet (the actual enforcement runtime,
  `workflow/gauntlet_project`).

**Is the split real or cosmetic? Real along four axes:**

- **Input/precondition:** PROPOSE assumes *no (or thin) harness* → generate one; ENFORCE assumes a
  harness *exists* → find drift/gaps. `RepoProfile` already gates this.
- **Output:** PROPOSE emits files/tasks to WRITE (via the hardened apply path); ENFORCE emits
  violations/gaps to FIX + policy config + gauntlet checks.
- **Cadence:** PROPOSE is a one-time bootstrap; ENFORCE is recurring (re-run as the codebase drifts,
  and runs per-task as the Structure-Lock Gauntlet).
- **User intent:** PROPOSE = "set up guardrails"; ENFORCE = "am I inside my guardrails / where are the
  holes."

**Caveat (partly cosmetic today):** the current single Harness scan produces both halves in one
fan-out, and the ENFORCE half is *under-built* — Harness detects conventions/gaps but does not yet
check "is convention X actually followed in all N sites" or "which existing lint rules have no
coverage." That deeper drift/coverage analysis is what a real ENFORCE mode adds (today it only exists
as the runtime Structure-Lock Gauntlet). So the split is a **real product framing** but the ENFORCE
side needs a modest new capability, not just a re-slice.

**What each half shares with Insight/Scorecard:** the ENFORCE/gaps half shares the Insight audit engine
(category fan-out → grounded findings grid) almost entirely. The PROPOSE half is the one genuinely
unique capability in the whole family (profile + synthesis + hardened apply) — it has no Insight/Scorecard
analogue and must stay first-class.

## Solution Options

### Option A — Status quo + deeper shared-core extraction
Keep 5 views + nav chips; push residual shape-duplication into the core: a generic
`FindingsResultsView` renderer keyed by a per-kind descriptor, a zod event-family factory that stamps
`*-started/*-item/*-completed/*-failed` from a config, and a codegen template so a sibling is a manifest
entry not a hand-cloned folder.
- Pro: lowest risk; no run-history/artifact migration; no UX change; keeps the parity rail.
- Pro: lowers the 8th-sibling cost incrementally.
- Con: does not address the user's actual complaint — the product still reads as N parallel tools.
- Con: diminishing returns; the algorithm is already shared, what's left resists compression without a
  renderer registry.

### Option B — One unified "Scans" hub
One "Scans" nav destination; a scan-kind picker on Configure; one shared run-history rail across kinds;
one findings model (base + kind-extras) with kind-specific renderers registered in a table. `RunLifecycleShell`
+ `useScanRun` already make this ~80% real.
- Pro: directly fixes "parallel wizards" — one door, pick your lens.
- Pro: cross-kind run history is genuinely useful; adding a kind becomes a registry entry.
- Con: PR Review (concurrent) and Issue Triage (list-driven) do not fit the single-run mold — they'd be
  awkward tenants; likely keep them separate and unify only the 3 codebase-analysis scans.
- Con: a unified findings model is a real contracts + Rust store migration (existing `.nightcore/{insights,
  scorecards,harness}/` history needs a migration or read-shim).
- Con: risks losing per-tool deep-link/muscle memory unless the picker preserves routes.

### Option C — Goal-oriented regrouping (Understand / Harden / Enforce / Verify) with the Harness split folded in
Reframe the nav around the product thesis ("full-loop autonomy inside a harness that prevents mistakes"),
grouping by user intent, not by which engine runs:
- **Understand** — Insight (find issues) + Scorecard (grade readiness) behind one shell with a
  find-vs-grade toggle. Scorecard *is* Insight-with-a-rubric, so this kills the most-redundant standalone.
- **Harden (Propose)** — the PROPOSE half of Harness: detect profile, generate the harness (lint-meta +
  ESLint plugin + CLAUDE.md/AGENTS.md), or propose extensions in the existing idiom.
- **Enforce (Gaps)** — the ENFORCE half of Harness: convention drift, unenforced conventions, harness gaps
  + Policy manifest + arming Structure-Lock checks.
- **Verify** — the runtime gates already on the board (Structure-Lock Gauntlet per task; PR Review) surfaced
  as the loop's exit gate, staying where the work is.
- Pro: the nav becomes the product story; each surface has a distinct intent, precondition, and output.
- Pro: resolves BOTH the Scorecard/Insight redundancy (merge) AND the Harness overload (split), and re-homes
  the three non-view features as parts of Harden/Enforce/Verify.
- Con: biggest UX + code change; needs Option B's renderer/model work AND new ENFORCE capability
  (drift/coverage-gap detection).
- Con: run-history/deep-link remap; the parity lint rule + codegen must follow the regroup; PR Review /
  Issue Triage still need a judgment call on which stage they belong to.

## Recommended Approach

**Target Option C, reached via Option B's mechanics, on Option A's continuing extraction — delivered in
phases, persistence-tier untouched until the last step.**

Phase 1 (highest signal, lowest risk — do first): **the Harness PROPOSE/ENFORCE split** the user asked for,
plus **fold Scorecard into an "Understand" surface with Insight.** Both are mostly a VIEW/NAV re-slice of
already-existing sections and view-models: re-route Harness's *Proposals + Artifacts + ProfileBanner + apply*
into a "Harden" destination and its *Conventions + Policy + gauntlet-arm* into an "Enforce" destination;
host Insight + Scorecard under one `RunLifecycleShell` with a find/grade toggle. **Crucially, keep the run
stores and `.nightcore/{insights,scorecards,harness}/` layout exactly as they are** — this is the de-risking
move; the regroup is a shell/nav concern, not a persistence change.

Phase 2 (optional, when a cross-kind history rail is wanted): add a **read-only `list_all_scan_runs`
aggregator** command (a union over the existing per-engine stores — zero migration) and a shared
`FindingsResultsView` primitive, i.e. Option B's mechanics without a data migration. Only adopt a single
on-disk findings model if a genuine unified store is later required (strongly prefer the aggregator).

Phase 0/ongoing: continue Option A's extraction (renderer registry, contract event-family factory) so the
tiers don't fight the regroup.

Why this order: the Harness split delivers real product clarity with mostly a UI re-slice, directly encodes
the "harness that prevents mistakes" thesis, and needs only a modest new ENFORCE capability; merging Scorecard
kills the most-redundant sibling; deferring the findings-model migration avoids the one genuinely risky step.
Keep PR Review (concurrent) and Issue Triage (list-driven) as their own destinations (PR Review reads as
Verify; Issue Triage as intake/Understand) — do not force them into a single-run hub.

## Files to Modify (recommended Phase 1 — sketch by tier)

- `apps/web/src/components/app/AppShell/nav.constants.tsx` — replace the 5 flat tool chips with the stage
  grouping (Understand / Harden / Enforce / Verify).
- `apps/web/src/components/app/AppShell/AppShell.types.ts` (`AppView`) + `AppShellViews.tsx` + routing/preselect
  plumbing — new stage routes; **remap `routing.scanTarget?.view === 'insight'|'scorecard'|'harness'` with a
  compat shim** (converted board tasks carry a stored source-ref back to the originating scan run/item via
  `routing.gotoSourceRef`, `AppShellViews.tsx:161`).
- `apps/web/src/components/insight/` + `apps/web/src/components/scorecard/` — host both view-models under one
  "Understand" shell with a find/grade toggle (reuse existing `useInsight`/`ScorecardView.hooks`).
- `apps/web/src/components/harness/HarnessView/HarnessView.tsx` — split the RESULTS `ResultsScreen`
  (`:139-241`) into two destinations: Harden (Proposals + Artifacts + ProfileBanner) and Enforce
  (Conventions/gaps + Policy + gauntlet-arm).
- `tools/lint-meta/rules/scan-family-parity.ts:31-39` — the `SINGLE_RUN_FAMILIES` enrolment map is keyed on
  `family folder → view`; it must move in lockstep with any folder merge/rename or CI reds.
- (Phase 2 only) `apps/desktop/src-tauri/src/sidecar/scan.rs` — add a read-only `list_all_scan_runs`
  aggregator; a shared `apps/web/src/components/ui/FindingsResultsView`.
- (If ENFORCE gets real drift/coverage capability) new `packages/contracts/src/harness-enforce.ts`
  (ConventionDrift / RuleCoverageGap) + a Harness-mode flag or a new `ScanManager` subclass in
  `packages/engine/src/scans/harness/`.

**Persistence migration:** Phase 1 = NONE (stores untouched; merged views read the same per-engine stores).
Only Phase 2's optional unified-history rail touches the sidecar, and even then via an additive read-only
aggregator, not a data migration.

## Reference Files (do not modify)

- `apps/web/src/lib/useScanRun.ts` — the single-run state machine every single-run sibling injects into.
- `packages/engine/src/scans/shared/scan-manager.ts:206` — the abstract orchestrator; the hook seams show
  exactly what a new/merged kind must supply.
- `apps/desktop/src-tauri/src/store/run_store.rs:1` — the generic `RunStore<R>`; keep the type-alias-per-feature
  pattern.
- `apps/desktop/src-tauri/src/sidecar/harness/apply.rs` — the security-critical `apply_harness_artifact` write
  path (symlink/clobber-defended). MOVE THE SURFACE, NOT THIS CODE.
- `packages/contracts/src/{insight,scorecard,harness}.ts` — the finding-model shapes and the "Profile twin" /
  "mirrors Insight's Finding" comments that anchor the merge.

## Risks & Gotchas

- **Parity lint + codegen move in lockstep.** `scan-family-parity` CI-fails if an enrolled `*View.hooks.ts`
  moves/renames without updating the rule's map. zod↔Rust↔ts-rs codegen is bidirectional (cargo test
  regenerates ts-rs; zod→Rust via the codegen tool) — any shared-base extraction must regenerate both and
  keep generated enums stable.
- **Stored source-refs / scanTarget deep-links** from converted tasks are a persistent back-reference; remapping
  nav keys needs a compat shim or old provenance chips break (see the memory note on source-ref key `pr-review`
  vs AppView `prreview`).
- **Do not force PR Review / Issue Triage into a single-run hub** — PR Review is concurrent (no `useScanRun`),
  Issue Triage is list-driven.
- **Do not refactor `apply_harness_artifact` during a UI regroup** — re-home the surface only.
- **ENFORCE is under-built today** — a real ENFORCE mode needs new drift/rule-coverage analysis; Phase 1 can
  ship as a re-slice of existing Harness output, but be explicit that it's not yet doing adherence checking.
- `MAX_RUNS=50` per store — a unified history rail aggregating 3 stores shows up to 150 runs; sort by
  `createdAt`.

## How to Verify

- `bun run lint` (scan-family-parity + component rules) and `bun run lint:meta` (zero violations on a clean tree).
- `bun run --filter @nightcore/web typecheck` (root `tsc -b` does NOT typecheck apps/web).
- `cargo test` (regenerates ts-rs + runs store/command tests).
- `bun run dogfood:ui` to confirm the nav regroup + deep-link/source-ref compat renders and routes.

## Open Questions

- Should Issue Triage and PR Review be folded into the stage model (Verify / intake) or stay as separate
  destinations? They break the single-run mold.
- Is a true ENFORCE capability (convention-drift + rule-coverage-gap detection) in scope, or is Phase 1 just a
  re-slice of Harness's existing output?
- Should Scorecard fully collapse into Insight (a "grade" lens) or remain a distinct sub-mode under Understand?
  It's ~80% a copy, but the grade→harden skill dispatch is a genuinely different action.
