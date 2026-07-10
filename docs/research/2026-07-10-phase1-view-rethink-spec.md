# Build spec: Phase-1 scan-view rethink (stage nav + Harness split + coverage)

**Date:** 2026-07-10
**Ticket:** wayfinder #96 (consolidation of #86 compat audit + #87/#94 ENFORCE scope + the scan-views rethink)
**Status:** build-ready. Every decision below is locked (grilled 2026-07-10). Do NOT re-litigate; implement.
**Prior art (read for context, not for decisions):**
`docs/research/2026-07-10-scan-views-rethink.md`,
`docs/research/2026-07-10-scan-nav-compat-audit.md`,
`docs/research/2026-07-10-enforce-capability-design.md`.

> An implementer with no session context can run **PR 1** directly from § 7. Each PR is
> independently green against all four gates (rust / node / web / plugin, § 8).

---

## 1. Scope

**In (Phase 1):**

- Regroup the sidebar into five stage groups — **Intake → Understand → Harden → Enforce
  → Verify** — as mono-uppercase group headers with child rows (headers kept even for
  single-child groups). Board / Worktrees / Settings stay as today's non-stage nav.
- **Understand** = one shell hosting a **Find | Grade** toggle: Find = Insight's
  view-model, Grade = Scorecard's (A–F dimension cards + "Harden this"). Two
  view-models / two `useScanRun` instances behind the toggle; per-mode run history.
- **Harden** = the Harness **PROPOSE** half (RepoProfile banner + Proposals + Artifacts +
  apply flow). **Enforce** = the Harness **ENFORCE** half (Conventions/gaps + Policy +
  gauntlet-arm) **plus** a new coverage capability: `enforced / documented-only /
  unenforced` badge per convention + a Rule-Coverage-Gaps panel (+$0.10–0.50/run).
- Compat shim so old provenance chips keep routing: freeze the six Rust `sourceRef` mint
  prefixes, add `family` to `ScanTarget`, retarget the `source-ref.ts` REGISTRY `view:`
  values to the stage keys **in the same commit** as the `AppView` union change, harden a
  lint so a REGISTRY view with no render branch is CI-red.
- PR Review (Verify child) and Issue Triage (Intake child) **keep their own destinations**
  and view-models — they are not folded into any single-run hub.

**Out (explicitly deferred — name them as the "Next" follow-up in copy/commits):**

- **Convention drift** ("is convention X followed at N of M sites?") — the Variant-3
  compile-once/run-forever machinery from the ENFORCE memo. Phase-1 Enforce ships
  **coverage, not conformance**; the UI must say so. The `ConventionDrift` contract is
  designed so Phase-1 shapes never migrate when drift arrives (`conventionFingerprint` is
  the stable join key).
- The Phase-2 cross-kind `list_all_scan_runs` history aggregator + shared
  `FindingsResultsView` renderer.
- Any change to run stores, the `.nightcore/{insights,scorecards,harness}/` directory
  layout, `apply_harness_artifact` internals, or the Rust mint formats.

**Hard constraints (do not violate):**

- Run stores + `.nightcore/{insights,scorecards,harness}/` **directory layout** untouched.
  The one permitted persisted-record change is the additive-serde `coverage` field on
  `HarnessRun` in PR 4 — flagged in § 4 and § 7.
- `apply_harness_artifact` internals untouched — **re-home the surface only**.
- `scan-family-parity` enrolment + zod↔Rust↔ts-rs codegen move in lockstep with any
  folder/rename (§ 5).
- **Shrink the `AppView` union; never orphan a member.** A union member with no render
  branch = a silent blank screen. Removing the member instead makes every stale literal a
  compile error.

---

## 2. Nav + routing changes

### 2.1 `AppView` union delta — `apps/web/src/components/app/AppShell/AppShell.types.ts:3-12`

Current union: `board | worktrees | insight | scorecard | harness | prreview | issuetriage
| projects | settings`.

| Action | Members | Rationale |
|---|---|---|
| **Remove** | `insight`, `scorecard`, `harness` | Their destinations die; folded into the stage shells |
| **Add** | `understand`, `harden`, `enforce` | The new stage shells |
| **Keep** | `board`, `worktrees`, `prreview`, `issuetriage`, `projects`, `settings` | PR Review + Issue Triage keep own destinations |

Removal + addition happen in the **flip PR (PR 3)**, together with the REGISTRY retarget and
the render-branch rewrites, so no member is ever orphaned.

### 2.2 `nav.constants` regroup — `apps/web/src/components/app/AppShell/nav.constants.tsx`

The sidebar already renders **mono-uppercase group headers with child rows**
(`NavSidebar.tsx:108-131`, `font-mono … uppercase tracking-[0.18em]`); `groupNavItems`
keeps any non-empty group including single-child ones (`NavSidebar.hooks.ts:27-38`). So the
regroup is a `NavGroupId` + meta + row-`group` remap — **no new rendering primitive** beyond
the Verify note (§ 2.4).

New `NavGroupId` (`AppShell.types.ts:17`) and order:

```
'project' | 'intake' | 'understand' | 'harden' | 'enforce' | 'verify' | 'settings'
```

`NAV_GROUP_META` + `GROUP_ORDER` (`NavSidebar.hooks.ts:6-15`):

| id | label | flags |
|---|---|---|
| project | Project | `collapsible: false` |
| intake | Intake | `collapsible: false` |
| understand | Understand | `collapsible: false` |
| harden | Harden | `collapsible: false` |
| enforce | Enforce | `collapsible: false` |
| verify | Verify | `collapsible: false`, `note: 'Structure-Lock Gauntlet runs per-task on the board'` |
| settings | Settings | `collapsible: false, footer: true` |

New `APP_SHELL_NAV` rows (`nav.constants.tsx`):

| view | label | hint | group |
|---|---|---|---|
| `board` | Kanban Board | `K` | project |
| `worktrees` | Worktrees | `W` | project |
| `issuetriage` | Issue Triage | `T` | intake |
| `understand` | Find & Grade | `U` | understand |
| `harden` | Propose | `H` | harden |
| `enforce` | Conventions | `E` | enforce |
| `prreview` | PR Review | `P` | verify |
| `settings` | Settings | `S` | settings |

Hints `K W T U H E P S` are all distinct (`I`/`R` freed by removing Insight/Scorecard).
`useNavShortcuts` is fully data-driven off `APP_SHELL_NAV` (`useNavShortcuts.hooks.ts:20-40`)
— **no change**.

### 2.3 Render branches — `apps/web/src/components/app/AppShell/AppShellViews.tsx`

> **Path correction:** both input docs write `apps/web/src/components/app/AppShellViews.tsx`.
> The real path is **`apps/web/src/components/app/AppShell/AppShellViews.tsx`**. All the
> line numbers those docs cite are correct against the real file.

Current scan render branches: `insight` (`:175`), `scorecard` (`:187`), `harness` (`:199`),
`prreview` (`:211`), `issuetriage` (`:223`); each gated preselect at `:181/193/205/217/229`;
`onOpenSourceRef={routing.gotoSourceRef}` at `:161`.

After the flip:

- Delete the `insight` / `scorecard` / `harness` branches.
- Add `understand` → `<UnderstandView … preselect={routing.scanTarget?.view === 'understand' ? routing.scanTarget : null} onPreselectConsumed={routing.clearScanTarget} />`.
- Add `harden` → `<HarnessView mode="harden" … preselect={routing.scanTarget?.view === 'harden' ? … } />`.
- Add `enforce` → `<HarnessView mode="enforce" … preselect={routing.scanTarget?.view === 'enforce' ? … } />`.
- `prreview` / `issuetriage` branches unchanged.
- The five view components pass the same 5-prop contract they use today
  (`projectPath`, `projectName`, `onGotoBoard`, `preselect`, `onPreselectConsumed`).

### 2.4 Verify note + breadcrumb

- **Verify note** (required): add optional `note?: string` to the `NAV_GROUP_META` entry
  type and render it as a muted caption under the group's items in `NavGroupSection`
  (`NavSidebar.tsx:135-147`). Non-interactive. Copy: *"Structure-Lock Gauntlet runs
  per-task on the board."*
- **Breadcrumb** (prototype-approved, implementation PR makes the final call): a thin top
  breadcrumb `nightcore / <Stage> / <leaf>` derived from a `view → stage` map. Non-blocking;
  omit if the implementer judges it redundant with the always-visible stage headers.

### 2.5 Deep-link / compat shim (per the audit — full detail § 4 + § 5)

- The only persisted view reference is `Task.sourceRef` (`store/task/model.rs:358`,
  free-form `String`, ts-rs `Task.ts:200`, no zod contract). The web chokepoint is the
  `source-ref.ts` REGISTRY. `gotoSourceRef` (`useRouting.hooks.ts:26-32`) parses via
  `parseSourceRef` → sets `scanTarget` → `setView(target.view)`; it needs **no change** —
  it routes wherever the REGISTRY points.
- Freeze the six Rust mint prefixes; retarget REGISTRY `view:` values; add `family`.
  Reads stay single-read through the retargeted REGISTRY — **no `.nightcore/tasks/*.json`
  rewrite, no migration, no write-path change.**

---

## 3. Understand shell design

**Home:** new folder `apps/web/src/components/app/UnderstandView/` (folder-per-component:
`UnderstandView.tsx`, `UnderstandView.hooks.ts`, `UnderstandView.types.ts`, `index.ts`,
`UnderstandView.stories.tsx`, `UnderstandView.test.tsx`).

**Why `components/app/` and not `components/understand/`:** `no-cross-feature-imports` is OFF
only for the `app` composition root (`COMPOSITION_ROOT_FEATURES = ['app']`,
`eslint.config.mjs:20-23,401-406`). The shell must import `<InsightView>` and
`<ScorecardView>` (runtime), which is legal **only** from `app/`. A `components/understand/`
folder would be lint-red. (This also means `AppShellViews` still imports the two feature
views transitively through `UnderstandView`.)

**Layout:**

- `UnderstandView` owns `mode: 'find' | 'grade'` state (`UnderstandView.hooks.ts`, default
  `'find'`) and renders a slim segmented **Find | Grade** toggle, then mounts the existing
  **`<InsightView>`** (find) or **`<ScorecardView>`** (grade). Keep both feature folders and
  their `*View.hooks.ts` **exactly as-is** — this is what keeps `scan-family-parity` green
  with zero map edits (§ 5) and guarantees zero persistence change (each inner view keeps
  its own contract, engine, `useScanRun`, and run store).
- **Two `useScanRun` instances**: one lives inside `InsightView.hooks.ts`, one inside
  `ScorecardView.hooks.ts`. `UnderstandView` never touches run state — it delegates.
- **Per-mode run history**: each inner view already renders its own history `Menu` (the
  Harness idiom, `HarnessView.tsx:262-274`), so history is per-mode for free.
- **Toggle state**: local `useState` in `UnderstandView.hooks.ts`. When a preselect target
  arrives, the shell flips `mode` to match `scanTarget.family` (below) so the chip lands on
  the right sub-view.

**Preselect routing (family-gated):** `AppShellViews` passes the target only when
`scanTarget.view === 'understand'`. `UnderstandView` then:

```
mode = scanTarget.family === 'scorecard' ? 'grade' : 'find'
<InsightView   preselect={scanTarget.family === 'insight'   ? scanTarget : null} … />
<ScorecardView preselect={scanTarget.family === 'scorecard' ? scanTarget : null} … />
```

The inner views consume the target via `usePreselectNavigation` keyed on `runId` (selectRun)
+ `kind`/`itemId` (onOpenItem) — **not** on `view` (`usePreselectNavigation.ts`,
`InsightView.hooks.ts:128-137`, `ScorecardView.hooks.ts:229-234`). So they work unchanged as
long as they receive a non-null preselect; the outer `view` vocabulary is invisible to them.

**Chrome (implementation-PR latitude, like the breadcrumb):** the minimal-diff default
mounts each inner view with its own `RunLifecycleShell` header ("Insight"/"Scorecard") below
the toggle. If the implementer wants a single unified header, lift the `RunLifecycleShell`
into `UnderstandView` and render the inner screens chromeless — this is optional polish, NOT
required for green, and must not touch the inner run stores.

---

## 4. Harden + Enforce destinations

### 4.1 The split is a view filter over ONE Harness run

The single `useHarnessView` run produces both halves from one fan-out and one store
(`HarnessScanCompletedEvent.findings` + `.proposals`, `harness.ts:399-407`). **Do not split
the engine, the run, or the store.** Add a `mode: 'harden' | 'enforce'` prop to `HarnessView`
and filter which sections render. This keeps one run/store (zero persistence change), keeps
`apply_harness_artifact` internals untouched, and keeps `scan-family-parity` enrolment
(`harness/HarnessView`) unchanged.

Section map (`HarnessSection = 'conventions' | 'proposals' | 'artifacts' | 'policy'`,
`HarnessView.types.ts:38`; `ResultsScreen` at `HarnessView.tsx:139-241`; section toggle at
`:169-199`):

| Section / feature | Harden | Enforce |
|---|---|---|
| ProfileBanner (`:166`) | ✅ shown | hidden |
| Proposals tab (`:180-185, 212-229`) | ✅ | — |
| Artifacts tab (`:186-191, 230-237`) | ✅ | — |
| Apply-to-disk flow (`HarnessOverlays`, `apply_harness_artifact`) | ✅ | — |
| Conventions/gaps tab (`:174-179, 201-211`) | — | ✅ |
| Policy tab (`:192-198, 238`) | — | ✅ |
| Gauntlet-arm (`PolicySection` + `ARMABLE_CHECK_KINDS`, `commands.rs:37`) | — | ✅ |
| **NEW** coverage badge + Rule-Coverage-Gaps panel | — | ✅ |

Implementation touch points:

- `HarnessView.types.ts` — add `mode` to `HarnessViewProps`.
- `HarnessView.tsx` `ResultsScreen` — render only the mode's `SectionTab`s; keep the
  `SectionTab`/grid/list sub-components as-is.
- `HarnessView.hooks.ts:69` — default `section` by mode (`harden → 'proposals'`,
  `enforce → 'conventions'`). The preselect `onOpenItem` branch (`:89-99`) already routes
  `kind === 'proposal' → proposals` else `conventions`; because the REGISTRY sends
  `harness-proposal → harden` and `harness → enforce` (§ 4.3), the section it sets is always
  valid for the mounted mode.
- **File-size:** `HarnessView.tsx` is 322 LOC; the 400-line web ratchet
  (`tools/lint-meta/rules/web-file-size-ratchet.ts`) is CI-critical. Extract the new
  coverage panel to its own component (below) rather than inflating `HarnessView.tsx`.

**Shared-run behavior note:** `harden` and `enforce` are two `AppView` keys; navigating
between them remounts the `HarnessView` instance (AnimatePresence keys on `view`). Both read
the same harness store, so run history is shared; a live run started in one stage keeps
running and the other stage reconnects to it via `useScanRun`'s list+subscribe on mount.
Acceptable Phase-1 behavior — no shared-state plumbing required.

### 4.2 New coverage capability (ENFORCE-lite = Variant 1 from the memo)

Coverage = **deterministic rule-inventory extraction + one cheap no-tool LLM join** in the
Harness scan's `finalize`. Per-convention status: `enforced` (a lint/meta rule at error
covers it) / `documented-only` (an agent doc claims it, no rule) / `unenforced` (neither).
**+$0.10–0.50 per scan, <60 s** added to the existing run.

**Contracts** — new file `packages/contracts/src/harness-enforce.ts` (see the memo § 3 for
the full sketch; ship `RuleCoverageGapSchema` + `CoverageStatusSchema` and their inferred
type twins; `Event` carve-out naming; kebab-case wire strings for clean Rust enum codegen).
Wire coverage onto the existing completed event **additively**:

```ts
// packages/contracts/src/harness.ts  (HarnessScanCompletedEvent, :399-407)
coverage: z.array(RuleCoverageGapSchema).default([]),   // mirrors proposals:.default([]) at :407
```

Do **not** mint a new `harness-enforce-*` event family in Phase 1 — coverage rides the
harness run additively (the memo's "additive alternative", § 3). The full event family is
Phase-2 drift territory.

**Engine pass** — `packages/engine/src/scans/harness/`:

- New `inventory.ts` (fs-only, `detectRepoProfile`-style, ~200–350 LOC): best-effort textual
  parse of `eslint.config.*` rule ids at `error|warn`, lint-meta registries when present,
  `.nightcore/harness.json` armed checks, and AGENTS.md/CLAUDE.md rule-name claims (the
  `agent-contract-parity.ts:29-42` glob-and-grep, generalized). Phase-1 honest limit:
  computed flat-configs are unresolved without `eslint --print-config` (a Rust exec seam,
  deferred) — surface the count in the UI ("inventory: N rules found").
- The join pass (~150–250 LOC): one no-tool `runTailSession` (the synthesis seam,
  `synthesis.ts:106`) called from `manager.ts` `finalize`, given the deduped
  `ConventionFinding`s + the inventory, returning one `RuleCoverageGap` per convention keyed
  on the existing `conventionFingerprint` (`findings.ts:46-52`). A deterministic tag/keyword
  pre-match short-circuits obvious pairs.

**Rust store — the one additive-persistence change (FLAGGED):**

- Add `#[serde(default)] pub coverage: Vec<RuleCoverageGap>` to the persisted `HarnessRun`
  at **`apps/desktop/src-tauri/src/store/harness/wire.rs`** (which already uses
  `#[serde(default)]` extensively — e.g. `source_findings:95`, profile fields `:273-276`).
- **Flag:** this touches the persisted *record shape*, not the *directory layout*. It is
  **serde-additive only** — old `.nightcore/harness/<runId>.json` files deserialize with
  `coverage = []` (identical to the shipped `proposals`/profile precedent), so there is **no
  migration, no data rewrite, no layout change**. This is the codebase's sanctioned
  "serde-additive" evolution and is the sole persisted-shape touch in all of Phase 1.
- **Additive alternative (rejected, documented for completeness):** keep `coverage` on the
  event only and never persist it — recompute each run. Rejected because re-opening a
  historical harness run would then show no coverage; the memo recommends the persisted
  field, gated behind `#[serde(default)]`. If a reviewer insists on zero record-shape change,
  the event-only variant is the fallback and costs nothing but history fidelity.

**Web** — `apps/web/src/components/harness/`:

- Coverage badge (`enforced / documented-only / unenforced`) on each row in
  `ConventionGrid` / its card (`ConventionGrid/ConventionGrid.tsx`).
- New `RuleCoverageGaps` component (its own folder) rendered in the **enforce** destination
  only (a section or panel below the conventions grid).
- UI copy anchor: **"coverage, not conformance"** — Phase 1 must NOT claim site-level
  adherence.

---

## 5. Lint / codegen lockstep checklist

| Concern | File | PR | Action |
|---|---|---|---|
| Scan-family parity map | `tools/lint-meta/rules/scan-family-parity.ts:31-39` | — | **No change.** `insight`/`harness`/`scorecard`/`issues` folders + `prreview` all preserved (Understand hosts, not renames; Harness stays one folder). Verify with `bun run lint:meta`. |
| Blank-screen hardening | `tools/lint-meta/rules/` (new `nav-render-parity.ts` or extend scan-family-parity) | 3 | ciCritical rule: every `source-ref.ts` REGISTRY `view:` value must appear as a `view === '<x>'` render branch in `AppShellViews.tsx`. Mechanic: `ctx.read` source-ref.ts → regex `view: '([a-z]+)'`; `ctx.read` AppShellViews.tsx → regex `view === '([a-z]+)'`; assert subset. Converts the blank-screen mode into CI-red. |
| ESLint plugin | `packages/eslint-plugin/` | — | **No rule change.** New `UnderstandView` folder must satisfy `component-folder-structure`/thin-shell/hook-budget; it is exempt from `no-cross-feature-imports` only because it lives under `app/`. |
| agent-contract-parity | `tools/lint-meta/rules/agent-contract-parity.ts` | — | **Unaffected.** No new `nightcore/*` **ESLint** rule is wired; the § 5 hardening is a lint-**meta** rule, so no AGENTS.md entry is required (avoids the `agent-contract-parity` trap). |
| Codegen zod→Rust | `apps/desktop/src-tauri/src/contracts/generated.rs` | 4 | Regenerate after adding `RuleCoverageGapSchema` + `CoverageStatusSchema` to `harness-enforce.ts`. Do not hand-edit. |
| Codegen Rust→ts-rs | `apps/web/src/lib/generated/` | 4 | `cargo test` regenerates the ts-rs TS after adding `HarnessRun.coverage`. Do not hand-edit. |
| Mint-prefix freeze | 6 Rust mint sites (§ 6) | 3 | Comment-only: add a "// paired with source-ref.ts REGISTRY — do not rename" note. No format change. |

PRs 1–3 have **zero** codegen (`ScanTarget` and its `family` field are pure web types in
`source-ref.ts`, not in `packages/contracts`, not codegen'd — confirmed by the audit). All
codegen is isolated to PR 4.

---

## 6. Test plan

Clone the named idioms; every file already exists.

1. **Parser compat** — `apps/web/src/lib/source-ref.test.tsx`. Keep the OLD-scheme literals
   (`'insight:run-1:finding-9'`, `'scorecard:…'`, `'harness:…'`, `'harness-proposal:run-4:prop-2'`,
   `'pr-review:…'`, `'issue-triage:val-7'`) and assert they now parse to the NEW stage `view`
   + the new `family` + unchanged `kind`/`runId`/`itemId`. Add a test titled *"legacy schemes
   keep parsing after the stage remap."* Keep the unknown-scheme → `null` cases verbatim.
   (PR 3)
2. **Routing compat** — `apps/web/src/components/app/AppShell/hooks/useRouting.hooks.test.tsx`
   (`mountRouter()` harness). Clone *"gotoSourceRef preselects … and routes to its view"*
   (`:59-68`) per legacy scheme; pin the literal stage key (`understand`/`harden`/`enforce`),
   not just an echo. Keep the malformed-token no-op (`:70-77`). (PR 3)
3. **Chip render + click** — `apps/web/src/components/board/TaskDetail/TaskDetail.test.tsx`
   (story `FromScanProvenance`, `TaskDetail.stories.tsx:143-151`). Add a case per legacy
   scheme + assert `onOpenSourceRef` fires with the raw token. (PR 3)
4. **Preselect landing per shell** —
   - Understand: mount `<UnderstandView preselect={{ view:'understand', family:'scorecard', kind:'reading', … }}>`,
     assert Grade mode + reading panel opens; `family:'insight'`/`kind:'finding'` → Find mode
     + finding panel. (New test in `UnderstandView.test.tsx`, PR 1 for the mode toggle, PR 3
     for the family-gated preselect.)
   - Harden: `<HarnessView mode="harden" preselect={{ view:'harden', family:'harness', kind:'proposal', … }}>`
     lands on the proposal. Enforce: `mode="enforce"`, `kind:'finding'` lands on the
     conventions tab. (PR 2/PR 3, extend `HarnessView` hooks/test.)
5. **Graceful degradation** — deleted run (`getRun → null`, `useScanRun.ts:236-241`) leaves
   the shell on its current stream with no panel; unknown scheme → no chip, `gotoSourceRef`
   no-ops. (PR 3)
6. **Shell integration** — `apps/web/src/components/app/AppShell/AppShell.test.tsx` (idiom
   *"routes to the Settings surface"*, `:36`): seed a task with
   `sourceRef:'insight:run-1:f-1'`, open the drawer, click "From Insight finding", assert the
   **Understand** surface renders. This is the only test exercising the full token → REGISTRY
   → union → render-branch chain (would catch the blank-screen mode). (PR 3)
7. **New-shell component/story tests** — `UnderstandView.stories.tsx` (Find/Grade default +
   toggled), `RuleCoverageGaps.stories.tsx`/`.test.tsx` (each coverage status), and a
   `HarnessView` story per `mode`. (PR 1 / PR 4 / PR 2 respectively.)

---

## 7. PR slicing (implement one at a time; each independently green)

Expand-then-contract: PRs 1–2 add the new shells additively (old Insight/Scorecard/Harness
rows coexist, so the app stays green and functional); PR 3 performs the atomic flip and
removes the old surfaces; PR 4 adds coverage. PRs 1–2 place their temporary nav rows in the
existing `tools` group and defer the stage regroup to PR 3.

### PR 1 — Understand shell (Find | Grade), additive

- **Scope:** new `components/app/UnderstandView/` with the Find|Grade toggle mounting the
  existing `<InsightView>`/`<ScorecardView>`; add `understand` to the `AppView` union + an
  `AppShellViews` render branch + a temporary nav row (`tools` group). No REGISTRY change.
- **Files:** `AppShell.types.ts` (union +`understand`), `AppShellViews.tsx` (branch),
  `nav.constants.tsx` (row), new `UnderstandView/*`.
- **Encodes:** Understand merge — one shell, Find|Grade toggle, two view-models / two
  `useScanRun`, per-mode history, **zero persistence change**.
- **Green because:** purely additive union member with a render branch (no orphan); parity
  map untouched (Insight/Scorecard folders intact).

### PR 2 — Harness Harden/Enforce mode, additive

- **Scope:** add `mode: 'harden' | 'enforce'` to `HarnessView`; filter `SectionTab`s +
  default section by mode; ProfileBanner+apply in harden, Policy+gauntlet-arm in enforce. Add
  `harden`+`enforce` to the union + `AppShellViews` branches (`<HarnessView mode=…>`) +
  temporary nav rows. Keep the `harness` row/branch during transition.
- **Files:** `HarnessView.types.ts`, `HarnessView.tsx`, `HarnessView.hooks.ts`,
  `AppShell.types.ts`, `AppShellViews.tsx`, `nav.constants.tsx`.
- **Encodes:** the PROPOSE/ENFORCE split as a view filter over one run/store;
  `apply_harness_artifact` untouched.
- **Green because:** additive; one engine/run/store; parity enrolment unchanged.

### PR 3 — The flip: family + REGISTRY retarget + union shrink + nav regroup + compat + lint

- **Scope (atomic — REGISTRY retarget MUST be in the same commit as the union change):**
  - Add `family` to `ScanTarget` (`source-ref.ts:11-16`); populate it per scheme in the
    REGISTRY; retarget `view:` values — `insight`/`scorecard` → `understand`, `harness` →
    `enforce`, `harness-proposal` → `harden`; `pr-review`→`prreview`, `issue-triage`→
    `issuetriage` unchanged.
  - Remove `insight`/`scorecard`/`harness` from the union; delete their `AppShellViews`
    branches and old nav rows.
  - Regroup `nav.constants` into the five stage groups; update `NavGroupId`,
    `NAV_GROUP_META`, `GROUP_ORDER` (§ 2.2); add the Verify `note` rendering
    (`NavSidebar.tsx`); optional breadcrumb.
  - `UnderstandView` gates preselect by `family`; `harden`/`enforce` branches gate preselect
    by their view key.
  - Freeze the six Rust mint prefixes (comment-only) — `sidecar/insight.rs:181`,
    `sidecar/scorecard.rs:163`, `sidecar/harness/convert.rs:46` & `:145`,
    `sidecar/pr_review.rs:292`, `sidecar/issue_triage/convert.rs:121`.
  - Add the blank-screen lint hardening (§ 5).
  - Add compat tests (§ 6 items 1–3, 5, 6).
- **Encodes:** compat shim, frozen mint prefixes, `family` discriminator, union shrink,
  stage regroup, blank-screen → CI-red.
- **Green because:** the union shrink makes every stale literal a **compile error** (loud,
  all fixed in-PR); the hardening rule + tests prove legacy schemes still route.

### PR 4 — Coverage capability (ENFORCE-lite)

- **Scope:** new `packages/contracts/src/harness-enforce.ts` (`RuleCoverageGapSchema` +
  `CoverageStatusSchema`); additive `coverage: …default([])` on `HarnessScanCompletedEvent`;
  engine `inventory.ts` + the no-tool join pass in `finalize`; **additive-serde
  `coverage` field on `HarnessRun`** (`store/harness/wire.rs`); regenerate `generated.rs`
  (zod→Rust) and ts-rs (`cargo test`); web coverage badge in `ConventionGrid` + new
  `RuleCoverageGaps` panel in the enforce destination; copy "coverage, not conformance."
- **Encodes:** the new coverage capability; the **one additive-persistence field** (§ 4.2).
- **Green because:** additive field (old runs default `[]`), codegen both directions in
  lockstep, badges/panel are new UI.
- **Ordering:** depends on PR 2's enforce surface for panel placement; may run in parallel
  with PR 3 (largely disjoint files) but is cleanest **last**.

---

## 8. Verification gates (run per PR)

```
bun run lint                              # eslint-plugin (folder-structure, no-cross-feature-imports) + scan-family-parity
bun run lint:meta                         # lint-meta rules; zero violations on a clean tree (incl. the new hardening in PR 3)
bun run --filter @nightcore/web typecheck # root `tsc -b` does NOT cover apps/web
cargo test                                # regenerates ts-rs (no-op through PR 3 since Task/HarnessRun unchanged; real regen in PR 4) + store/command tests
bun run dogfood:ui                        # manual: stage nav renders, Find|Grade toggles, provenance chips route to the right stage
```

- **PR 3** is the gate-sensitive one: after the union shrink, `typecheck` is the safety net
  (stale literals = compile errors); `lint:meta` must be green with the new render-parity
  rule; `dogfood:ui` must show old provenance chips (`insight:` / `harness:` /
  `harness-proposal:`) landing on Understand / Enforce / Harden respectively.
- **PR 4** is the only PR where `cargo test` performs a real ts-rs regen and the zod→Rust
  codegen tool must be re-run — commit both generated outputs; never hand-edit them.
```
