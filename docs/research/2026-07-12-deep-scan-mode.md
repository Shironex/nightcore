# Research: Deep Scan Mode (multi-round, exclusion-list, opt-in) for Nightcore's scan family

**Date:** 2026-07-12
**Agent:** kirei-research
**Status:** complete (read-only; no code changed)

## Problem

Ground the design of an opt-in "Deep" scan mode: instead of one grounded model pass
per category (Insight = 9 categories, capped at `MAX_FINDINGS_PER_CATEGORY = 8`,
"return AT MOST 8, highest-impact first"), Deep mode runs MULTIPLE ROUNDS per
category, each round told "you already found these N issues, now find NEW distinct
ones," accumulating + de-duplicating until convergence (K consecutive low-yield
rounds) or a budget/round/time ceiling. Must persist partial results as it goes
(multi-hour/day run must survive interruption), be cancellable, show progress/spend,
and the results grid must handle hundreds of findings.

This document maps today's exact mechanics across all 4 tiers (contracts / engine /
Rust store / web) and surfaces the open design decisions a build spec needs.

## (a) End-to-end lifecycle map

```
web (apps/web)                    Rust core (src-tauri)                 engine (packages/engine)
───────────────                   ──────────────────────                ─────────────────────────
RunControls "Analyze" click
  → useInsightView.onAnalyze
  → bridge.startAnalysis(...)  →  #[tauri::command] start_analysis
                                     (sidecar/insight.rs:49)
                                     begin_scan_run() → persist InsightRun
                                       status:"running" (upsert_if_idle,
                                       single-flight per project)
                                     dispatch_scan_command()
                                       → SurfaceCommand::StartAnalysis  →  ScanRouter.dispatch
                                                                            → AnalysisManager.start(cmd)
                                                                              (insight/manager.ts,
                                                                               extends ScanManager)
                                                                            emit `analysis-started`
                                                                            runPool(categories, concurrency=6,
                                                                              worker) — PARALLEL, bounded
                                                                              (scan-manager.ts:277, pool.ts)
                                                                            per category (worker):
                                                                              emit `analysis-category-started`
                                                                              runItem() → runOneSession()
                                                                                → new SessionRunner(...)
                                                                                  (ONE Claude SDK session,
                                                                                   read-only tools, maxTurns=40)
                                                                                → parse → 1 corrective retry
                                                                                  on bad JSON
                                                                              ground(findings) — drop
                                                                                hallucinated file refs
                                                                              emit `analysis-category-completed`
                                <── nc:insight channel        <── raw event forwarded verbatim
                                    handle_analysis_event()
                                      "analysis-category-completed":
                                        insight_store.accumulate_findings()
                                        → PERSISTS to
                                          .nightcore/insights/<runId>.json
                                          (mid-run, incremental)
Live UI folds `analysis-category-*`
  (categoryState, peek grid)
                                                                            (after ALL categories) finalize():
                                                                              dedupeFindings(all) — cross-
                                                                                category fingerprint dedup
                                                                              emit `analysis-completed`
                                    "analysis-completed":
                                      reconcile_scan_history() (dismissed/
                                        converted carry-forward)
                                      finalize_scan_items()
                                        → AUTHORITATIVE final write,
                                          status:"completed"
Results screen renders
  FindingGrid (paged, 60/page)
```

Key file:line anchors for this map:
- Command dispatch: `apps/desktop/src-tauri/src/sidecar/insight.rs:47-135` (`start_analysis`)
- Router: `packages/engine/src/scans/scan-router.ts:120-153` (`ScanRouter.dispatch`)
- Category fan-out is **PARALLEL, bounded-concurrency** (NOT sequential):
  `packages/engine/src/scans/shared/scan-manager.ts:277-325` calls
  `runPool(this.items(command), command.maxConcurrency ?? DEFAULT_CONCURRENCY, async (item) => {...})`,
  and `DEFAULT_CONCURRENCY = 6` (`scan-manager.ts:44`). `runPool` itself
  (`packages/engine/src/scans/shared/pool.ts:14-28`) is a simple N-worker cursor pool —
  `cap` workers each loop `while (cursor < items.length)`.
- One category = one "pass" = one `runOneSession()` call
  (`scan-manager.ts:424-547`), which spins exactly one `ScanSessionRunner`
  (`SessionRunner` for Claude, or the Codex provider path) via the injectable
  `ScanRunnerFactory` (`scan-manager.ts:90-97`, `defaultRunnerFactory`). This is the
  seam a test (or a future round loop) can substitute.
- The per-item corrective-retry wrapper is `ScanManager.runItem` at
  `scan-manager.ts:359-418` — **it is `private`**, called only from the pool worker
  inside `execute()` (`scan-manager.ts:277-325`), also private. A subclass
  (`AnalysisManager`) CANNOT override either method today — see Design Decision 1.

## (b) What persists / what's lost on interruption TODAY

**Persistence is already incremental — per completed CATEGORY pass, not batched to
the end.** This is the load-bearing fact for the whole Deep-mode design:

- `apps/desktop/src-tauri/src/sidecar/insight.rs:330-359` — the `"analysis-category-completed"`
  arm calls `insight_store.accumulate_findings(run_id, parsed, &dismissed, cost, ...)`
  for EVERY category as it finishes, not just at the end. Comment at
  `store/insight.rs:308-316`: *"Merge one category pass's findings into a still-`running`
  run so a cancel or crash keeps the partial results already paid for."*
- `accumulate_findings` → `RunStore::accumulate_items` (`store/run_store.rs:542-592`) is a
  no-op once `run.status() != "running"` — so it can never race/clobber the terminal
  write, and a late-arriving category event after finalize is safely dropped.
- The terminal `"analysis-completed"` event (`insight.rs:279-314`) is what
  `finalize_scan_items`/`finalize_completed` (`sidecar/scan.rs:236-354`) treats as
  **authoritative**: it re-writes `run.findings` wholesale with the engine's final
  cross-category-deduped set, carrying forward any in-run dismiss/convert by
  fingerprint (`sidecar/scan.rs:309-354`).
- Each write is `write_atomic` to `.nightcore/insights/<runId>.json`
  (`store/run_store.rs:214-223`), one file per run, in-memory map is the read source
  of truth with write-through on every mutation.

**What survives an interruption, concretely:**
| Interruption | What happens | What's lost |
|---|---|---|
| App restart (boot) | `RunStore::reap_running()` (`run_store.rs:355-374`) marks every `running` run `failed`, stamping `INTERRUPTED_ERROR = "interrupted (app restarted mid-analysis)"`. Findings array is **untouched** — every category that had already emitted `analysis-category-completed` before the crash is still in the file. | Only the ONE category-pass that was literally in-flight at the moment of the crash (not yet persisted) — because a whole category is currently one atomic unit of persisted work. |
| Sidecar-only crash (Rust alive) | `reap_scans_on_crash` (`sidecar/reader.rs:66-121`, tagged "T14") snapshots `InsightStore::running_ids()` and synthesizes an `analysis-failed` event routed through the SAME handler a real failure uses — so the run flips to `failed` immediately (UI stops spinning) without waiting for the next app boot. Findings again untouched. | Same as above: the in-flight category's pass. |
| User cancel | `AnalysisManager.cancel(runId)` (`scan-manager.ts:242-249`) sets `run.cancelled = true` and calls `interrupt()` on every live `ScanSessionRunner`. Back in `execute()` (`scan-manager.ts:327-330`): `if (run.cancelled) { this.emitFailed(...'aborted'...); return; }` — **`finalize()` is SKIPPED entirely on cancel.** | The terminal `analysis-completed` (cross-category dedup) never fires — but every category that had ALREADY completed before the cancel is already durably persisted via its own `analysis-category-completed` → `accumulate_findings`. The category that was mid-flight when interrupted contributes **nothing** — `emitItemCompleted` (which is what triggers persistence) is only called when `!run.cancelled` (`scan-manager.ts:292`, `302`), and a runner that was interrupted returns `{findings: [], reason:'aborted'}` (`scan-manager.ts:375-377`) anyway. |

**Bottom line:** today's unit of persisted, interruption-safe work is **one whole
category pass** (worth up to 8 findings, one Claude session, ~tens of seconds to a
few minutes). Deep mode's "must survive interruption across hours/days" requirement
means the persisted unit needs to become **one ROUND**, not one category — a category
that runs 12 rounds over an hour must not lose 11 rounds' worth of paid findings to a
crash 2 minutes before it would have converged. This directly motivates Design
Decision 2 below.

## Facts 1–8 (as requested)

**1. Run lifecycle / parallel vs sequential** — answered above (b). Categories run
**PARALLEL**, bounded by `DEFAULT_CONCURRENCY = 6` or `command.maxConcurrency`
(`scan-manager.ts:44,121,279`). Each category's "session"/"pass" is minted by
`ScanRunnerFactory` (`scan-manager.ts:90-97`) — the Claude path constructs a
`SessionRunner` directly with `appendSystemPrompt` + `allowedTools`/`disallowedTools`
+ `maxTurns` + optional `maxBudgetUsd` (`scan-manager.ts:446-490`); the Codex path
routes through `ProviderRegistry.forSession()` instead (`scan-manager.ts:494-531`).

**2. Persistence timing** — INCREMENTAL, per category, not batched-at-end. See (b).
Rust owns persistence in `apps/desktop/src-tauri/src/store/run_store.rs` (generic
`RunStore<R: PersistedRun>`) + `apps/desktop/src-tauri/src/store/insight.rs`
(`InsightStore = RunStore<InsightRun>`), one JSON file per run at
`.nightcore/insights/<runId>.json`.

**3. Cancellation** — Web `useScanRun.cancel()` (`apps/web/src/lib/useScanRun.ts:230-234`)
calls the family's `cancelRun` bridge fn → Rust `cancel_analysis`
(stamped by the `scan_lifecycle_commands!` macro, `sidecar/scan.rs:82-90`) → dispatches
`SurfaceCommand::CancelAnalysis` → `ScanRouter.dispatch` →
`AnalysisManager.cancel(runId)` (`scan-manager.ts:242-249`, inherited from the base) →
sets `run.cancelled` + `interrupt()`s every live `ScanSessionRunner`. **Cancel keeps
only already-completed categories' findings** (see table above); the in-flight
category's partial work is discarded. There is a per-SESSION **idle watchdog**
(`packages/engine/src/providers/claude/session-runner.ts:94-121`, `DEFAULT_IDLE_TIMEOUT_MS
= 30 * 60 * 1000`) that trips if the SDK stops yielding messages — this already
covers a single stuck round/pass; there is no run-level (whole-scan) watchdog, nor
does one exist in the Rust store beyond the boot-time `reap_running`.

**4. Cost/usage tracking** — YES, tracked per pass and accumulated per run.
`ScanManager.execute()` accumulates `totalCost`/`totalUsage` across every category
(`scan-manager.ts:267-268,313-314`, `addUsage()` at `scan-manager.ts:643-649`); each
category's own `costUsd`/`usage` streams on `analysis-category-completed`
(`insight/manager.ts:148-164`). Rust extracts it via `ScanTelemetry::from_event`
(`sidecar/scan.rs:137-163`) and persists it on `InsightRun.cost_usd`/`usage`
(`store/insight.rs:194-201`); `accumulate_findings`/`accumulate_usage`
(`run_store.rs:81`, `252-256` in insight.rs) means a CANCELLED run still shows what
it spent. There is already a per-pass spend ceiling primitive:
`command.maxBudgetUsdPerCategory` → SDK `Options.maxBudgetUsd`
(`session-options.ts:177-181,497-499`) — a hit ceiling fails that ONE session
(`session-failed { reason: 'max-budget' }`), it is NOT a run-total ceiling. This is
**entirely separate** from the account-wide "Usage meter" feature (OAuth polling of
Anthropic's usage API, `project_usage_meter.md`) — no coupling exists or is needed;
a Deep-mode spend ceiling should extend the scan's own `totalCost` accumulator, not
touch the Usage meter subsystem. There is no ETA field/estimate anywhere in the scan
pipeline today (`RunProgress` shows `costUsd`/`usage`/elapsed only —
`apps/web/src/components/ui/RunProgress/RunProgress.tsx`).

**5. Dedup reach** — `dedupeFindings` (`packages/engine/src/scans/shared/findings.ts:360-368`)
wraps the fully generic `dedupeBy` (`packages/engine/src/util/dedupe.ts`), keyed by
`f.fingerprint` — a stable hash of `normalizeFile(file) + '|' + normalizeTitle(title)`
computed once at parse time (`findings.ts:66-69`, deliberately **category- and
line-independent** so the survivor's category can change without breaking the
dismissed-history key). It is called ONCE, in `AnalysisManager.finalize()`
(`insight/manager.ts:166-184`), over `findings: TFinding[]` — the flat array of EVERY
grounded finding from EVERY category pass, with no grouping. **This means dedup
already works correctly across ROUNDS with zero changes** — a round's findings just
need to land in that same flat `all` array (`scan-manager.ts:265,315`) before
`finalize()` runs; `dedupeBy` doesn't know or care whether two matching-fingerprint
items came from different categories or different rounds of the same category.

**6. Contracts + codegen** — `StartAnalysisCommand` is defined at
`packages/contracts/src/commands.ts:197-221` (zod). Existing fields that are the
closest precedent for a "mode" toggle: `scope: AnalysisScopeSchema` (`repo` | `diff`,
rendered as a 2-chip radio in `apps/web/src/components/insight/RunControls/RunControls.tsx:48-56`)
and the two PER-CATEGORY ceilings `maxTurnsPerCategory` / `maxBudgetUsdPerCategory`.
**There is no existing generic "mode"/"depth"/"preset" field** — `scope` is the only
analog. Codegen: zod → Rust is `bun run codegen:contracts`
(`tools/codegen/gen-rust-contracts.ts`) which produced the matching Rust variant at
`apps/desktop/src-tauri/src/contracts/generated.rs:78-97` (`SurfaceCommand::StartAnalysis`,
`#[serde(rename_all="camelCase")]`, `Option<T>` for every zod-`.optional()` field);
Rust → TS is `ts-rs` (`#[cfg_attr(test, derive(TS))]` on `store/insight.rs` structs,
regenerated by `cargo test`, landing under `apps/web/src/lib/generated/`). A new Deep
field touches: `packages/contracts/src/commands.ts` (zod) →
`bun run codegen:contracts` (regenerates `generated.rs`) → any new persisted Rust
struct field needs `#[cfg_attr(test, derive(TS))]` re-export via `cargo test`.

**7. Results UI** — `apps/web/src/components/insight/FindingGrid/FindingGrid.tsx`
maps findings 1:1 to `DetailCard`s and hands them to the shared
`DetailCardGrid` (`apps/web/src/components/ui/DetailCardGrid/DetailCardGrid.tsx`).
**Confirms the memory note precisely**: it is **page-capped, not virtualized** —
`DetailCardGrid.tsx:9-12`: *"How many cards to mount before the 'show more'
affordance. Large scans yield hundreds of findings; capping the initial mount count
keeps open/tab-switch/resize cheap"* — `PAGE_SIZE = 60`, via
`usePagedChildren` (`DetailCardGrid.hooks.ts`): mounts a growable PREFIX window
(`all.slice(0, visibleCount)`), "Show N more" button appends `+PAGE_SIZE` to the
mount count — **every revealed card stays mounted** (no windowing/eviction), so at,
say, 500 findings a user who clicks through would end up with 500 live DOM subtrees
simultaneously, same as today with zero cap. **True virtualization already exists in
this repo** — `apps/web/src/components/board/Column/Column.hooks.ts:2,52-58` uses
`@tanstack/react-virtual`'s `useVirtualizer({ count, getScrollElement, estimateSize,
overscan })` for the board's task columns. That is the primitive to reuse for a real
windowed grid if Deep-mode result counts (a few hundred, post-dedup, across 9
categories × K rounds) outgrow what click-to-reveal paging handles comfortably.

**8. Precedent** — **none found.** Grepped `packages/engine/src/scans` for
"already found" / "exclusion" / "do not repeat" / "previously found" / "round " /
"convergence" / "low-yield" / "diminishing" — no hits anywhere in the codebase. The
closest mechanical analog is the existing **single corrective retry** on unparseable
JSON (`scan-manager.ts:388-409`, `RETRY_REMINDER_ARRAY`/`RETRY_REMINDER_OBJECT`) —
architecturally it IS "re-run the same pass with an augmented prompt," but its
purpose is fixing malformed output, not eliciting new distinct findings, and it is
capped at exactly one retry with no loop/convergence concept. Deep mode is a
genuinely new pattern for this codebase.

## (c) Exact touchpoints across the 4 tiers

### Tier: contracts (`packages/contracts/src/`)
- `commands.ts:197-221` — `StartAnalysisCommand`: add the Deep-mode request fields
  (mode toggle + ceilings). Mirror the `AnalysisScopeSchema` pattern
  (`insight.ts:22-32`) for a new mode enum if going that route.
- `insight.ts` — if convergence/round metadata needs to reach the UI as typed
  contract fields (vs. Rust-only persisted fields), a new schema block belongs here,
  alongside `FindingCategorySchema`/`FindingSchema`.
- `insight.ts:118-163` — the `analysis-*` event family (`AnalysisStartedEvent`,
  `AnalysisCategoryStartedEvent`, `AnalysisCategoryCompletedEvent`,
  `AnalysisCompletedEvent`, `AnalysisFailedEvent`). A new intermediate
  `analysis-category-round-completed` event (or a `round`/`roundsPlanned` field
  added to the existing `AnalysisCategoryCompletedEvent`) lives here — see Design
  Decision 3.
- `event-fragments.ts:25-38` — `runTotals`/`scanFailure` shared fragments; reuse
  as-is (no change needed) for a new round event's cost/usage shape.

### Tier: engine (`packages/engine/src/scans/`)
- `shared/scan-manager.ts:359-418` (`ScanManager.runItem`, **private**) — this is
  where the round loop must live per Design Decision 1: it currently runs exactly
  one `runOneSession` (+ 1 corrective retry) and returns. Becomes: while under the
  round/convergence/budget ceilings, run one round (existing logic unchanged), fold
  its grounded findings into a running `foundSoFar: TFinding[]`, emit the
  round-completed hook, check convergence, build next round's prompt with the
  exclusion-list suffix, repeat.
- `shared/scan-manager.ts:100-122` (`BaseScanCommand`) — needs an optional `deep`
  field surfaced generically enough that only `StartAnalysisCommand` actually sets
  it (Harness/Scorecard/PR-review/Issue-triage commands never populate it, so their
  `runItem` path is byte-identical to today — see Design Decision 4 on scope).
- `shared/scan-manager.ts:174-183` (`ItemCompletedArgs`) / new hook — a per-round
  emit hook parallel to `emitItemCompleted` is needed so `AnalysisManager` can emit
  the new round event without breaking the existing per-category-terminal shape.
- `insight/manager.ts:99-106,204-232` (`buildPrompt`/`buildCategoryPrompt`) — the
  exclusion-list suffix (titles + locations of `foundSoFar`) is appended here for
  round ≥ 2.
- `insight/presets.ts:108-128` (`outputContract`) — the per-round output contract
  wording changes from "Return AT MOST 8 findings" to "Return AT MOST 8 **NEW**
  findings **not already listed above**"; `MAX_FINDINGS_PER_CATEGORY = 8`
  (`insight/manager.ts:56`) stays the PER-ROUND cap unchanged — Deep mode's growth
  comes from rounds, not a bigger single-pass cap.
- `shared/findings.ts:360-368` (`dedupeFindings`) — **no change needed** (fact 5).
- `shared/pool.ts` — **no change needed**; rounds are sequential WITHIN one
  category's pool-worker slot, categories stay parallel across slots exactly as
  today.

### Tier: Rust store (`apps/desktop/src-tauri/src/`)
- `store/run_store.rs:542-592` (`RunStore::accumulate_items`) — **reusable
  as-is** for round-level persistence: it already unions by item `id`, is a
  running-only no-op, and accumulates usage — this is exactly the "persist as you
  go" primitive Deep mode needs; a new round-completed event just needs to call it
  (via `insight_store.accumulate_findings`) the same way `analysis-category-completed`
  does today (`sidecar/insight.rs:340-359`).
- `sidecar/insight.rs:269-363` (`handle_analysis_event`) — add a match arm for the
  new round event (or extend the `"analysis-category-completed"` arm to also read a
  `round` field) — persists via the SAME `accumulate_findings` call.
- `sidecar/reader.rs:39-64` (`INSIGHT_CRASH_FAILED_TYPE` + `crash_failed_event`) —
  **no change needed**: the T14 sidecar-crash reap already fails the run
  immediately without touching `run.findings`, so partial round work already
  persisted survives; only work not yet round-persisted at crash time is lost
  (matches Design Decision 2's goal once rounds — not categories — are the
  persisted unit).
- `store/insight.rs:184-205` (`InsightRun`) — if UI needs to show "round 4 of ≤12"
  per category, that state must persist somewhere; either a new
  `roundsByCategory: HashMap<String,u32>` field on `InsightRun`, or derive it
  transiently client-side from the live event stream only (not persisted) — see
  Design Decision 5.
- `store/run_store.rs:35` (`MAX_RUNS = 50`) — no per-run finding-count cap exists;
  a Deep run accumulating a few hundred findings does not hit any existing ceiling.

### Tier: web (`apps/web/src/`)
- `components/insight/RunControls/RunControls.tsx:48-56` — add the Deep toggle
  alongside the existing `scope` chip pair (same UI idiom).
- `lib/useScanRun.ts` — **no change needed**; the generic run-lifecycle hook
  already handles arbitrary live events via the family-injected `onEvent`; a new
  round event is just another case in Insight's `onEvent` fold.
- `components/insight/InsightView/InsightView.hooks.ts:157-167` (`gridFindings`) —
  no structural change; still filters `stream.findings` by `activeTab`.
- `components/ui/RunProgress/RunProgress.tsx` + `.types.ts` — needs a per-category
  round indicator (e.g. "round 4, 2 new") and ideally a run-level spend-ceiling /
  remaining-budget readout for a long Deep run.
- `components/ui/DetailCardGrid/DetailCardGrid.tsx:9-12` + `.hooks.ts` — the
  existing `PAGE_SIZE = 60` click-to-reveal paging is the fallback; for genuinely
  large Deep result sets, swap in `@tanstack/react-virtual`
  (already used at `components/board/Column/Column.hooks.ts:52-58`) for a real
  windowed grid — see Design Decision 6.

## Files to modify (build-spec candidate list)
- `packages/contracts/src/commands.ts` — `StartAnalysisCommand` Deep fields
- `packages/contracts/src/insight.ts` — new round event (+ any Deep-specific
  persisted-state schema)
- `packages/engine/src/scans/shared/scan-manager.ts` — round loop in `runItem`
  (Decision 1), new round-hook, `BaseScanCommand.deep` field
- `packages/engine/src/scans/insight/manager.ts` — exclusion-list prompt wiring,
  round-hook implementation
- `packages/engine/src/scans/insight/presets.ts` — `outputContract` wording for
  round ≥ 2
- `apps/desktop/src-tauri/src/contracts/generated.rs` — codegen output (via
  `bun run codegen:contracts`, do not hand-edit)
- `apps/desktop/src-tauri/src/sidecar/insight.rs` — new round-event match arm
- `apps/desktop/src-tauri/src/store/insight.rs` — optional per-category round
  count field (Decision 5's UI needs it persisted or it resets on reconcile)
- `apps/web/src/components/insight/RunControls/RunControls.tsx` — Deep toggle
- `apps/web/src/components/insight/InsightView/InsightView.hooks.ts` — fold the
  new round event, resume-action wiring (Decision 6)
- `apps/web/src/components/ui/RunProgress/` — round/ceiling UI (Decision 7)
- `apps/web/src/components/ui/DetailCardGrid/` — optional virtualization swap
  (Decision from fact 7) if hundreds-of-findings paging proves insufficient

## Reference files (do not modify — pattern to mirror)
- `packages/engine/src/scans/shared/pool.ts` — the bounded-concurrency pool Deep
  mode's round loop must NOT touch (categories stay parallel; rounds stay
  sequential within one worker slot)
- `packages/engine/src/util/dedupe.ts` — the generic fingerprint dedup that
  already works across rounds with no changes
- `apps/desktop/src-tauri/src/store/run_store.rs` — the generic `RunStore`
  accumulate/persist primitives to reuse verbatim for round-level persistence
- `apps/web/src/components/board/Column/Column.hooks.ts` — the existing
  `@tanstack/react-virtual` usage pattern, if virtualization is adopted

## Risks & gotchas
- `ScanManager.runItem`/`execute` are `private` — Decision 1 is a real
  architectural fork in the road, not a detail; get it confirmed before coding.
- The T14 sidecar-crash-reap literal-matching (`reader.rs:39-50`) is
  string-exact against the contract's event-type literals — a new round event
  type must be added there ONLY if the reaper needs to synthesize it on crash
  (it does not, per Decision 3 — the existing `analysis-failed` synthetic event
  is enough since round-level persistence already happened via the real events).
- `accumulate_items`/`accumulate_findings` re-serializes the WHOLE run file on
  every call (`run_store.rs` comment at `persist()`, `insight.rs`) — fine at
  hundreds of findings, but if Deep mode is later generalized to a scan whose
  findings could reach the thousands, revisit (not a v1 concern).
- The existing per-round `maxBudgetUsdPerCategory` is an SDK-level PER-SESSION
  ceiling (a hit ceiling FAILS that session with `reason: 'max-budget'`, it does
  not gracefully stop-and-keep-partial) — a new per-category-TOTAL or run-total
  ceiling must be enforced by the ORCHESTRATOR checking its own accumulator
  BEFORE starting the next round, not by asking the SDK to enforce a multi-round
  total.
- `upsert_if_idle` is single-flight PER PROJECT (`store/run_store.rs:239-246`) —
  a Deep run occupies that slot for its entire multi-hour lifetime, blocking any
  other Insight run (including a quick non-Deep one) on the same project until it
  finishes/cancels/fails. Worth flagging as an explicit product tradeoff, not an
  accidental limitation to "fix" in v1.

## How to verify (once built)
- Start a Deep run over a small fixture repo with an artificially low
  `maxRoundsPerCategory`/tight convergence K; confirm `.nightcore/insights/<runId>.json`
  grows after EACH round (not just at the end) by watching the file between rounds.
- Kill the app process mid-run (`kill -9` the Tauri process) after round 2 of some
  category; reboot; confirm the run shows `failed` but `findings` contains round
  1 + round 2's items (not zero, not round 3+).
- Cancel mid-round; confirm findings from already-converged categories persist and
  the UI shows the neutral "cancelled — partial results below" state
  (`InsightView.tsx:179-195`).
- Feed a repo where a category's issues are exhausted quickly; confirm the round
  loop stops at K consecutive 0-new rounds rather than running to
  `maxRoundsPerCategory`.
- Push a fixture to a few hundred total findings; confirm the results grid stays
  responsive (paging or virtualization, per Decision from fact 7).

## Open questions
- Decision 1 (base-class vs fork) needs an explicit maintainer call before
  implementation — it is the highest-blast-radius choice in this spec.
- Whether the per-round `outputContract` cap (8) should differ for Deep mode
  (Decision 5) is a product call, not purely technical.
- Whether Harness gets Deep mode in the SAME build or a strict follow-on
  (Decision 4) affects how much of Decision 1's generalization to build now vs.
  defer.
- This document was NOT validated interactively with the user before being
  written — the `AskUserQuestion` tool specified in this agent's own step 5 was
  not present in this session's tool set. The key finding to confirm before
  build: **Decision 1 (round loop lives in the shared `ScanManager` base class,
  gated by an opt-in `deep` field only Insight's command sets) and Decision 2
  (the ROUND, not the category, becomes the persisted/interruption-safe unit)**
  — these two decisions drive almost every other touchpoint in this document.

## Build spec — LOCKED decisions + slice plan (2026-07-12)

Decisions confirmed with the maintainer (user chose the maximal/most-exhaustive option on each):

- **Scope (D4):** ALL THREE scan families get Deep mode — Insight (Find & Grade),
  Harness (Propose), AND PR Review. The generalization lives in the shared
  `ScanManager` base (Decision 1, confirmed), so all three inherit it. Note: PR Review
  is diff-bounded, so its round loop CONVERGES FAST (a round or two) — built anyway,
  self-limits. Insight/Harness are the whole-codebase cases that run long.
- **Stop rule:** CONVERGENCE ONLY — stop after `convergenceEmptyRounds` (K) consecutive
  rounds that add ZERO net-new (post-dedup) findings. NO spend ceiling (user chose
  uncapped $). A `maxRoundsPerCategory` backstop is retained purely as a
  non-convergence safety rail (a model that emits 1 junk net-new finding per round
  forever must still terminate) — it is NOT a cost control. Running spend stays VISIBLE
  and the run stays CANCELLABLE so the user steers manually.
- **Per-round cap:** RAISED for Deep mode — `maxFindingsPerRound` default **20** (vs the
  single-pass 8). Volume comes from BOTH the bigger per-round cap AND many rounds.
- **Decision 1 (base-class, confirmed):** round loop generalized into shared
  `ScanManager` base, gated by an optional `deep` field on `BaseScanCommand` that only
  Deep-enabled commands set. Non-deep path stays BYTE-IDENTICAL (locked invariant —
  every non-deep scan family's behavior must be unchanged; prove it in review).
- **Decision 2 (round = persisted unit, confirmed):** each round emits a
  round-completed event → `accumulate_findings` persists per ROUND (not per category),
  so a multi-hour category that crashes 2 min before converging keeps every prior
  round's paid findings.
- **Defaults (tunable):** K = 2 empty rounds; `maxRoundsPerCategory` backstop = 15;
  `maxFindingsPerRound` = 20. Per-category round count PERSISTED on the run (so
  "round N" survives reconcile/resume). NO spend-ceiling field in v1.
- **Virtualization:** REQUIRED (not the paging fallback) — raised cap × many rounds ×
  3 families ⇒ hundreds of findings; adopt `@tanstack/react-virtual` (board pattern) in
  `DetailCardGrid`.

### Slice plan (dependency-ordered; backbone serializes the rest)
1. **Slice 1 — BACKBONE** (kirei-loom / opus; adversarially gated — forks the most-shared
   engine file): contracts (`BaseScanCommand.deep` + Deep params; new
   `analysis-category-round-completed` event; codegen) + engine (round loop in
   `ScanManager.runItem` gated by `deep`; round-emit hook; convergence check;
   exclusion-list prompt suffix + `outputContract` "NEW findings not already listed"
   wired for Insight) + Rust (round-event arm → `accumulate_findings`; persist
   per-category round count). Non-deep path byte-identical. Full engine + Rust tests
   incl. convergence-stop, exclusion-prompt, per-round persistence. Web toggle NOT yet —
   deep is driven by the contract field + tests. MERGE-gated before anything builds on it.
2. **Slice 2 — Insight UI** (after backbone): Deep toggle in `RunControls` (mirror the
   `scope` chip), round + running-spend indicator in `RunProgress`, fold the round event
   in `InsightView`.
3. **Slice 3 — extend Deep to Harness + PR Review** (after backbone; mostly mechanical —
   base does the work): set `deep` + exclusion suffix + toggles for both families.
4. **Slice 4 — grid virtualization** (independent of backbone): swap `DetailCardGrid`
   paging → `@tanstack/react-virtual` windowing; benefits all scans.

Sequencing: Slice 1 lands + passes the gate FIRST; then 2/3/4 fan out (2 & 3 & 4 touch
mostly disjoint files and can parallelize). Each slice = its own PR, labels + attribution
rules per house convention, adversarial gate on the backbone + any verdict/security surface.
