# Combined Findings: Architecture — What's Wired vs. What's Unused

**Date:** 2026-06-22
**Skill:** /kirei-chain
**Lenses:** arch, refactor
**Scope:** `packages/*`, `apps/desktop` (Rust/Tauri), `apps/web` (React board), with `apps/sidecar` as the bridge tier. Explicitly **excluded** `apps/cli` and `apps/tui` per request.

## Per-Lens Reports
- **Architecture (what's wired):** `docs/arch/2026-06-22-wiring-map.md` — includes a Mermaid dependency graph of the real wired path
- **Refactor (what's unused):** `docs/refactor/2026-06-22-unused-code-audit.md` — file-by-file removal candidates tagged CONFIRMED / SUSPECTED / only-cli-tui

## Headline: the architecture is healthy
Both lenses independently concluded the codebase is **unusually clean**. The intended 3-tier architecture is **real and complete end-to-end**:

```
apps/web (React) -> Tauri invoke -> apps/desktop (Rust core) -> NDJSON stdio -> apps/sidecar (Bun) -> @nightcore/engine -> Claude Agent SDK
```

- `tsc -b` passes with `noUnusedLocals`/`noUnusedParameters`; `cargo check` has **zero** `dead_code` warnings. There is no accidental rot.
- Zero circular dependencies (madge, 105 files). Clean DAG: `contracts`/`shared` are leaves, `engine` is the hub.
- The Tauri command surface is **perfectly symmetric** — all 30 registered commands have a `bridge.ts` wrapper; no orphans either direction; all 5 events have web listeners.
- `apps/web` is fully reachable from `App.tsx`; no unrendered component folder.
- The `m2/` orchestrator (coordinator/provider/slots/worktree/breaker/deps) — the biggest "wired or island?" question — is **fully wired**: managed Tauri state (`lib.rs:70,79`), 5 registered commands (`lib.rs:122-126`), every submodule on the live path. **Not** a parallel subsystem.

So the unused surface below is **deliberately-parked seams and redundant copies**, not cruft.

## Cross-Cutting Themes (flagged by BOTH lenses — highest leverage)

### 1. The custom tool stack (`@nightcore/tools` + `@nightcore/mcp`) is wired-but-inert — the single biggest item
- **refactor:** `ToolRegistry.buildSdkMcpServer()/.mcpServers()/.descriptors()` are never called; sessions run **native-tools-only** (`session-runner.ts:147-153`). The only live `ToolRegistry` use is `riskOf()`, which short-circuits on `NATIVE_READONLY_TOOLS` before reaching `descriptors()`. => `@nightcore/tools` (10 tool impls: echo/fs/git/read-file/search/shell) **and** `@nightcore/mcp` are dead weight in the runtime.
- **arch:** `@nightcore/mcp` is imported as descriptors but the registry is empty and external-MCP transports are explicitly deferred (`tool-registry.ts:39-40`) — "placeholder, not live capability."
- **Convergence:** both lenses agree this subsystem is parked. The code's own comments call it a "later removal pass." This is a **product decision**, not a code decision (see Conflicts).

### 2. The contract spine isn't enforced -> copies have already drifted
- **arch (High risk):** TWO hand-mirrored contract boundaries with NO codegen. Rust reads sidecar events via raw `.get("camelCase")` (`sidecar.rs:189-285`) and builds commands via `serde_json::json!` (`provider.rs:387`); web hand-mirrors Rust serde structs (`bridge.ts:56-57`). A field rename fails **silently** (dropped event / `undefined`), not at compile time. `tools/codegen` is a tool scaffolder, not a contract generator.
- **refactor (concrete proof):** web `lib/models.ts` `MODEL_OPTIONS`/`EFFORT_OPTIONS` parallel the contracts zod schemas and have **already drifted** — `claude-haiku-4-5-20251001` (web) vs `claude-haiku-4-5` (contracts). `bridge.ts:42` also re-declares `TaskKind` identically to `contracts TaskKindSchema`.
- **Convergence:** arch predicts silent drift; refactor found a live instance of it. Same root cause: the zod spine in `packages/contracts` is copied by hand instead of being the single source.

### 3. Sidecar packaging is defined but unwired (release seam)
- **arch:** sidecar runs as `bun run apps/sidecar/src/index.ts` (workspace-relative dev path, `lib.rs:71` / `provider.rs:184`). The `compile` script + `binaries/` `externalBin` path exist in config, but `binaries/` doesn't exist and `tauri.conf.json` has **no** `externalBin`. => a `tauri build` artifact would not find its sidecar (release blocker).
- **refactor (cross-lens):** `apps/sidecar/package.json` `compile`/`bin` are unused by the live path.
- **Convergence:** both flag the compile/bin path as unused — same root: dev uses `bun run`, the production packaging path was never wired.

## Conflicts Between Lenses
No hard conflicts — the lenses are complementary and agreed on every shared finding. One **tension worth naming** (it's a decision, not a contradiction):

- On the tools/mcp subsystem, **refactor leans "remove it"** (largest cleanup, ~L effort) while **arch treats `mcp` as a deferred-but-intended capability** (a placeholder for planned external-MCP support). Refactor itself tagged this removal **"arch-gated — only after arch confirms native-tools-only is permanent."** => Resolution is a **product call by the user**: is native-tools-only the permanent design, or is the tool/MCP stack a roadmap seam to keep? Everything downstream (delete vs. document) follows from that one answer.

## Unified Priority Order
Ranked across BOTH lenses (leverage x risk), not severity-within-one-lens:

1. **DECISION — fate of `@nightcore/tools` + `@nightcore/mcp`** *(cross-cutting; arch + refactor)*. Gates the single largest body of code. Either commit to native-tools-only -> remove both packages (Effort L), or keep and document as a roadmap seam. **Needs the user's answer before any code moves.**
2. **Wire sidecar packaging for release** *(arch)* — `externalBin` + `bun run compile`, provider prefers the binary and falls back to `bun run` in dev. Effort M, Risk Medium. **Practical release blocker** even though it's not "unused" in the usual sense.
3. **Fix the contract drift that already happened** *(refactor, quick)* — consolidate web `lib/models.ts` <-> contracts, fix the haiku-id mismatch, replace `bridge.ts:42` local `TaskKind` with `import type { TaskKind } from '@nightcore/contracts'`. Effort XS–S, Risk Low.
4. **Quick confirmed-dead cleanup** *(refactor)* — delete 7 zero-importer leaf exports (`KnownModelSchema`, `SurfaceCommandOf`, `tryCatchAsync`, `expandHome`, `logger` singleton, `qualifiedToolName`, `GitStatusEntry`); drop the unused `@nightcore/config` dep from `packages/engine/package.json` (verified: engine mentions it only in a comment, never imports it). Effort XS, Risk Low.
5. **Contract codegen (structural)** *(arch)* — generate Rust serde structs from the zod spine (zod->JSON-Schema->`schemars`/`typify`) so the sidecar/web boundaries stop being hand-mirrored. Effort L, Risk High. The durable fix for theme #2; do #3 first as the cheap stopgap.
6. **Split `sidecar.rs`** *(arch; cross-lensed by refactor)* — ~1180-line god file; extract the M4 verification state machine. Effort M, Risk Medium.

## Recommended Execution Strategy
**Stagger, don't bundle** — the changes have very different risk profiles and one is decision-gated.

- **PR A (now, no decision needed):** priorities 3 + 4 together — confirmed-dead deletions, drop unused dep, dedupe web<->contracts, fix haiku drift. All independent and low-risk; `tsc -b` (with `noUnusedLocals`) surfaces any miss immediately. -> **kirei-build**, typecheck after each step.
- **DECISION GATE:** resolve priority 1 with the user.
  - If native-tools-only is permanent -> **PR B:** remove `@nightcore/tools` + `@nightcore/mcp` and their wiring. -> **kirei-forge** (multi-file).
  - If the tool stack stays -> instead add a one-paragraph roadmap note in the package READMEs so the next audit doesn't re-flag it.
- **PR C (independent, release-hardening):** priority 2 sidecar packaging. -> **kirei-forge**.
- **PR D (larger, optional):** priority 5 contract codegen, landed incrementally (one type first -> verify `cargo check` + `tsc -b` -> expand). -> **kirei-forge**. Priority 6 (`sidecar.rs` split) can ride alongside or follow.

## Out of Scope (Surfaced but Not Investigated)
- **Reserved `research` / `decompose` task kinds** — defined in contracts but not driven by any live flow (refactor cross-lens). Not investigated; candidate for a follow-up `/kirei` once the tools/mcp decision is made (may be related roadmap surface).
- **`SessionManager.listModels()` + `ModelDescriptor` + `NightcoreEventOf`** — reachable only from `apps/tui`, which is out of scope. Effectively dead for current focus; **keep** (don't delete) until tui is back in scope.
- **`sidecar.rs` M4 verification state machine** — arch flagged it as the natural extraction target for the god-file split but did not deeply map it.
- **7x Rust `#[allow(dead_code)]` markers** — documented intentional future seams (e.g. `Outcome::NeedsApproval`, several provider accessors). Left alone deliberately.
