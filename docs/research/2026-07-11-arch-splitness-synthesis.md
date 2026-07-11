# Arch & packaging "splitness" — synthesis

Date: 2026-07-11. Reviewer: synthesis of four independent read-only slice reviews
(Rust core, web front-end, sidecar+contracts, monorepo/packages). Grounded against
the actual tree (file:line spot-checks below). Related: roadmap map #141.

## Verdict

The codebase is **unusually well-factored for a solo project, and the factoring is
self-enforcing** — `src/arch_guards.rs` pins the Rust layer ranks, `no-cross-feature-imports`
holds the web feature boundaries (zero feature→feature runtime edges), an eslint block
seals the Claude SDK inside `providers/claude/**`, and the seven TS packages form a clean
acyclic DAG. **The correct near-term move is consolidate-and-fix-coupling, not extract.**
**Net-new packages/crates justified today ≈ 0** — every extraction the slice reviews
proposed has exactly *one* consumer right now, and the largest real duplication is
**Rust↔TS vocabulary** (`untrusted_block`, severity, git-error copy), which no package
move can fix — only the contracts+codegen conformance pattern that already works for
`channels.ts` can.

## Reconciling the four lenses

The three per-slice reviews (Rust, web, sidecar) each surfaced extraction candidates
*inside their own slice*: the Rust review wants a Cargo workspace with `git`/`pty`/`usage`/
`repo-map`/`contracts` crates; the web review wants `@nightcore/scan-kit`/`wire-types`/
`bridge`/`ui`; the sidecar review — notably — proposes **no new packages**, only seam
repairs inside `engine`. The fourth (meta) review looked across all slices and applied
the only bar that matters for a monorepo: **a new package needs (a) two real consumers
today or (b) a wire/process boundary; everything else lands in an existing home.**

Under that bar, every sibling extraction fails *today*:

- `@nightcore/scan-kit` — one consumer (web's five families); already barrel-exported at
  `lib/scan-run.ts`. It "mirrors" the engine's `scans/shared/` but that is the *Rust/TS
  twin*, not a second importer of the web kit.
- `@nightcore/wire-types`, `@nightcore/bridge`, `@nightcore/ui` — one consumer each (web).
- The Rust crates (`git`, `pty`, `usage`, `repo-map`, `contracts`) — one consumer (the
  single Tauri crate); there is no second Rust binary.
- `@nightcore/policy`, `@nightcore/providers` — one consumer (the engine); the one-sidecar
  decision (#18) removed the second consumer that would justify them.

**Ruling: side with the meta lens.** The per-slice reviewers were right that the *seams*
are real and clean — they were wrong (understandably, from inside one slice) to read
"real seam" as "extract now." A real seam is a **refactor** boundary; a **package**
boundary additionally needs a second consumer or a process boundary. So we take the seam
fixes they found as in-app refactors, keep every extraction alive behind a named trigger,
and spend the near-term budget on the two things that actually reduce duplication and kill
bug classes: **contracts-vocabulary consolidation** and **coupling fixes**.

The two closest calls, ruled explicitly: **web `scan-kit`** → refactor-in-app (one
consumer, already barrelled); **Rust `nightcore-contracts` crate** → rides the
Cargo-workspace trigger (it is the crate the *other* crates would share, so it is only
meaningful once a second Rust binary exists).

## Grounding spot-checks (verified in-tree)

| Claim | Where | Verified |
|---|---|---|
| Generic `RunStore` imports concrete `insight::LinkOutcome` | `store/run_store.rs:30` | yes |
| Wire type `TokenTotals` homed in a feature module, consumed by usage | `usage/contract.rs:22`, `usage/cost.rs:21` ← `workflow/trust/contract.rs:185` | yes |
| `@openai/codex-sdk` has **no** confinement lint (only claude-agent-sdk, ×2) | `eslint.config.mjs:205,235`; zero codex hits | yes |
| Severity vocabulary triplicated; web admits structural identity | `apps/web/src/lib/severity.ts:1-20` | yes |
| Supervisor imports `providers/claude/*` (the "provider-neutral" leak) | `engine/src/session/session-manager.ts:37-38` | yes |
| `safe_join` is `pub(super)` inside `harness/apply.rs`, not in `infra/` | `sidecar/harness/apply.rs:106` | yes |
| `untrusted_block` implemented twice (Rust + TS) | `infra/untrusted.rs:20` + `engine/src/scans/shared/untrusted.ts` | yes |
| git-error mapped by stderr substring | `apps/web/src/lib/git-error.ts:21-51` (`lower.includes('not verified')` …) | yes |
| Stale pre-refactor `dist/` ghosts coexist with current tree | `packages/engine/dist/{agent-presets,analysis-manager}.js` vs `src/{index,policy,providers,scans,session,util}` | yes |

## Ranked action table (near-term, v0.3→v0.4)

Ranked by leverage-per-effort. Type ∈ {fix-coupling, consolidate-vocab, refactor-in-app,
extract-now, defer-with-trigger}.

| # | Action | Type | Effort | Payoff | Risk | Source lens | Existing ticket? |
|---|---|---|---|---|---|---|---|
| 1 | Add `@openai/codex-sdk` confinement lint (clone the claude block, carve-out `providers/codex/**`) | fix-coupling | S | Kills a drift bug-class the Claude rule exists to prevent; security | none | sidecar C3 | — (fits provider work) |
| 2 | Consolidate **severity** into one `contracts` `SeveritySchema` + per-family aliases; delete web structural mirror | consolidate-vocab | S | Removes a 3-way vocabulary clone across Rust+TS+web | low | meta #2 / web | — |
| 3 | Hoist `TokenTotals` out of `workflow/trust/` into a rank-1 contract home (`store/types.rs`) | fix-coupling | S | Removes wire-type-in-feature-module smell; unblocks a future usage crate | low | rust C2 | — |
| 4 | Invert `RunStore → insight::LinkOutcome`: move `LinkOutcome` into `run_store.rs`/`store/types.rs` | fix-coupling | S | Generic module stops depending on one feature it abstracts | low | rust C1 | — |
| 5 | Clean stale `packages/engine/dist/` + add a `prebuild` rimraf / `tsc -b --clean` habit | refactor-in-app | S | Closes a silent ghost-module load hazard for web/sidecar | low | meta build-hygiene | — |
| 6 | Relocate `session-ledger.ts` out of `session/` (→ `util/` or beside policy) | refactor-in-app | S | Makes engine dirs a strict DAG | none | sidecar C5 | — |
| 7 | Hoist `safe_join` (path validator) from `harness/apply.rs` to `infra/` **before** any 2nd agent-file writer copies it | fix-coupling | S/M | Pre-empts a copy-paste of a security-critical validator | low | rust god-file #4 | T14 #155 (security floor) |
| 8 | Structure **git-error codes** in `contracts`, codegen to Rust; web maps codes not stderr copy | consolidate-vocab | M | Kills the silent "Rust wording tweak breaks web toast" bug-class | med | meta #4 | — |
| 9 | Pin `untrusted_block` fence markers/keywords in `contracts`; conformance-test both impls | consolidate-vocab | M | One anti-injection primitive stops being maintained twice with divergent delimiters | med | meta #1 | T14 #155 (security floor) |
| 10 | Split `@nightcore/shared` into universal (`.`: result/ids/formatters) vs `./node` (paths/which); absorb the web↔engine cost/elapsed formatter dup | refactor-in-app | S/M | Gives web its first import-legal pure-TS home; drains the formatter clone | med (node-in-bundle — guard with a lint rule) | meta #2 / web | — |
| 11 | Collapse per-kind store lifecycle triplication (`insight`/`pr_review`/`scorecard`, ~300 ln) via a generic `impl` or `lifecycle_methods!` macro | refactor-in-app | M | Removes ~300 near-verbatim lines (fenced today → cost, not risk) | low | rust C5 | — |
| 12 | Commands-by-feature reshuffle in `contracts` (Start*/Cancel* to feature files; `commands.ts` keeps session+union+queries) via the proven `event-fragments` pattern | refactor-in-app | S/M | Drains a mild grab-bag; generated Rust byte-identical if spreads preserved | low | sidecar C4 | — |
| 13 | Move `board/session-stream.ts` transcript fold + types to `lib/`; reorg flat `lib/` into strata (`lib/domain/`) | refactor-in-app | S/M | Fixes the "board is a shadow shared feature" wart; discoverability | low | web Wart 1/2 | — |
| 14 | Put `SessionHistory` behind an `AgentProvider` capability; move `session-api.ts`+`mappers.ts` behind it | fix-coupling | M | Fixes the one broken "no provider branching in orchestration" promise; unblocks provider-neutral History for Codex | low | sidecar C1 | — |
| 15 | Unify the scan run path through `AgentProvider` (grow `StartSessionParams`; delete `defaultRunnerFactory`'s direct `new SessionRunner`) | fix-coupling | M | Removes the degraded second run-path every new provider inherits; precondition for a future providers package | med (14k scan test lines) | sidecar C2 | — (v0.4-leaning) |

Do #14/#15 for their own sake (they fix live coupling), *and* because they are the cheap
seam fixes that any future `@nightcore/providers`/`@nightcore/policy` extraction is blocked
behind — doing them now keeps that door open at near-zero marginal cost.

## Trigger-gated future extractions

None of these should be built now. Each is listed with the exact event that reopens it.

| Extraction | Source lens | Trigger to reopen |
|---|---|---|
| Cargo **workspace** + `crates/` | rust / meta #4 | A **second Rust binary** (headless daemon / CLI) is a committed ticket, **or** incremental compile time measurably hurts daily work. Then split along existing seams (`contracts/`, `git/`, `infra/`). |
| `nightcore-git` / `nightcore-pty` / `provider-usage` / `repo-map` crates | rust | Same as the Cargo-workspace trigger — they are members of a workspace that does not yet exist. `repo-map` gets a secondary trigger: if tree-sitter rebuild cost dominates app-crate compile time. |
| `nightcore-contracts` crate | rust | The Cargo-workspace trigger — it is only meaningful as the crate other crates share. |
| `@nightcore/policy` | sidecar #5 / meta #3 | A **headless CI-gate / CLI runner is a committed ticket** — the portable-lock #134 (`npx @nightcore/harness`) is the natural second consumer. Extract only after seam fixes #14/#15, and only when #141/#142 hardening has stopped reshaping the gate API. |
| `@nightcore/providers` | sidecar #4 | A **3rd provider** or an **out-of-process provider host**. Blocked behind #14/#15; drags `policy/` with it, so `policy` extracts first. |
| `@nightcore/scan-kit` | web #1 | A **second consumer of the web kit** (a Storybook workspace or a second front-end surface). Today it is a refactor-in-app (already barrel-exported). |
| `@nightcore/wire-types` (ts-rs bindings) | web #2 | A **second TS consumer of the Rust→TS bindings** (a CLI, a dogfood harness, or a 2nd front-end). |
| `@nightcore/bridge` | web #3 | Dogfood/Storybook needing the typed client + mocks — and only after `wire-types`. |
| `@nightcore/ui` (pure core only) | web #4 | A **second UI consumer / a Storybook workspace**. Storybook alone is borderline; require a real second surface. Extract "pure core, leave app-composites" — 13 bridge-coupled folders stay behind. |

## Where to STOP

- **Seven packages for a solo project is already at the healthy ceiling** (three are under
  350 LOC). Each new package costs a root tsconfig reference, a hand-maintained `test:node`
  path, lint-meta/AGENTS parity, and — as the stale `packages/engine/dist/` ghosts prove — a
  fresh `tsc -b`-never-cleans emit surface.
- **The flat-ish parts are flat for a reason.** Web's `lib/` + eslint rules beat a package
  for single-consumer sharing (and the observed intra-web helper clones happened *despite*
  a shared home existing — packaging would not have prevented them). The single Rust crate +
  `arch_guards.rs` beat a Cargo workspace with no second consumer. `tools/` importing
  contracts **source** (not `dist/`) is a deliberate stale-artifact defense, not an omission.
- **The honest line:** after the contracts-vocabulary consolidation and the `shared`
  universal/node split, **stop creating packages/crates.** Nothing else in the tree has two
  consumers today. `policy`, `providers`, and `crates/` each have a written trigger; until a
  trigger fires, the correct number of net-new nodes is **zero**. The next dollar of
  structure spend is better put into build hygiene than into more workspace nodes.

## Concrete near-term wins (worth doing regardless of any extraction)

**Rust↔TS vocabulary dedup (via contracts + codegen/conformance):**
- `severity` → one `SeveritySchema` in contracts; delete web's structural mirror
  (`apps/web/src/lib/severity.ts:10`) and the per-family enum clones. *(action #2)*
- `untrusted_block` → pin the fence markers/keywords in contracts and conformance-test the
  Rust (`infra/untrusted.rs:20`) and TS (`engine/src/scans/shared/untrusted.ts`)
  implementations against them. *(action #9, T14 #155)*
- git-error → structured **codes** in contracts, codegen'd to Rust emit sites; web maps
  codes instead of `lower.includes('not verified')` (`apps/web/src/lib/git-error.ts:21`).
  *(action #8)*

**Coupling smells (in-app refactors):**
- `RunStore → insight::LinkOutcome` inversion (`store/run_store.rs:30`). *(action #4)*
- `usage → workflow::trust::TokenTotals` hoist to a rank-1 contract home
  (`usage/contract.rs:22`, `usage/cost.rs:21`). *(action #3)*
- `safe_join` hoist from `sidecar/harness/apply.rs:106` to `infra/` **before** a second
  agent-file writer copies it (copy-paste is the failure mode). *(action #7, T14 #155)*
- Per-kind store lifecycle triplication (`insight`/`pr_review`/`scorecard`) → generic impl
  or macro. *(action #11)*

**Provider hygiene:**
- Session-history leak: move `SessionApi`+`mappers` behind an `AgentProvider.sessionHistory()`
  capability so the supervisor stops branching on Claude
  (`engine/src/session/session-manager.ts:37-38`). *(action #14)*
- Missing `@openai/codex-sdk` confinement lint — clone the claude block
  (`eslint.config.mjs:235`) with a `providers/codex/**` carve-out. *(action #1)*

**Build hygiene:**
- Delete stale `packages/engine/dist/` ghosts (`agent-presets.js`, `analysis-manager.js`, …)
  and add a clean step so `tsc -b` can't leave loadable ghosts. *(action #5)*
