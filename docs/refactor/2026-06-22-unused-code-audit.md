# Nightcore Unused-Code Audit (kirei-refactor lens)

**Date:** 2026-06-22
**Agent:** kirei-refactor
**Lens:** "what is UNUSED" — file/export/function/dependency-level dead code + duplication
**Scope:** packages/* (config, contracts, engine, eslint-plugin, mcp, shared, skills, storage, tools), apps/desktop (Rust), apps/web. **Excluded:** apps/cli, apps/tui (out of scope — but used as a signal to label "only-cli-tui").
**Sibling:** kirei-arch owns the module-level wiring graph; architectural notes are deferred to it under "Cross-lens".

## How "used" was determined

- **Live in-scope runtime path:** apps/web → apps/desktop (Rust) → apps/sidecar → @nightcore/engine → claude-agent-sdk; @nightcore/contracts is the shared schema spine. The sidecar drives the engine via **only** `manager.on()` + `manager.dispatch(SurfaceCommand)` (verified: `apps/sidecar/src/index.ts:100,117,156`). It never calls `listModels()` or any other engine method.
- `tsc -b` over the whole repo is **clean** with `noUnusedLocals`/`noUnusedParameters` on (`tsconfig.base.json:19-20`, `apps/web/tsconfig.json:9-10`). So there are **zero** unused locals/imports/private members — every dead item below is at the **cross-module exported-symbol** level, which the compiler cannot see.
- `cargo check` on apps/desktop is **clean** (no `dead_code` warnings) because the 7 genuinely-unused Rust items are explicitly `#[allow(dead_code)]`.
- Labels: **CONFIRMED-dead** = zero importers anywhere in scope (and usually nowhere at all). **SUSPECTED** = importers exist only in tests/stories, or the symbol is a union member consumed via its umbrella. **only-cli-tui** = the only consumers are the out-of-scope apps/cli or apps/tui, so it is effectively dead for the user's current focus.

## Summary — top priorities

1. **The custom in-process tool stack is unreachable in the live path.** `ToolRegistry.buildSdkMcpServer()` / `.mcpServers()` / `.descriptors()` are never called (session-runner sets native-tools-only per M4.7 §A2). The only live use of `ToolRegistry` is `riskOf()`, and `riskOf` short-circuits on `NATIVE_READONLY_TOOLS` **before** it ever touches `descriptors()`. Net effect: **`@nightcore/tools` (all 10 tool impls + descriptors) and `@nightcore/mcp` (`externalMcpServers`) are dead weight in the runtime** — they exist only for a deferred path. The code itself documents this ("stay in the tree for a later removal pass", `session-runner.ts:153`). Highest-leverage cleanup, but **coordinate with arch** — it is a subsystem decision, not a one-line delete.
2. **`@nightcore/config` is a declared dependency of `@nightcore/engine` but never imported** (only mentioned in comments). One-line `package.json` fix. CONFIRMED.
3. **Duplicated model/effort/kind vocab between web and contracts.** `apps/web/src/lib/models.ts` hand-rolls `MODEL_OPTIONS`/`EFFORT_OPTIONS` (and `lib/bridge.ts` re-declares `TaskKind`) that parallel `@nightcore/contracts` (`KnownModelSchema`, `EffortLevelSchema`, `TaskKindSchema`). Meanwhile the contracts model registry (`KnownModelSchema`, `ModelDescriptorSchema`) is itself unused in scope. The two halves of the same concept have already drifted (`claude-haiku-4-5` vs `claude-haiku-4-5-20251001`).

## Dead code to remove

### CONFIRMED-dead (zero importers anywhere)

| File:line | Symbol | What | Risk | Effort |
|-----------|--------|------|------|--------|
| `packages/contracts/src/config.ts:48` | `KnownModelSchema` / `KnownModel` | Curated model enum. `ConfigSchema.model` is a free `z.string()`, so this enum gates nothing; no importer in any app (incl. cli/tui). Already drifted from web's `MODEL_OPTIONS`. | Low | XS |
| `packages/contracts/src/commands.ts:101` | `SurfaceCommandOf<T>` | Generic `Extract` helper. `NightcoreEventOf` has a tui consumer; `SurfaceCommandOf` has **none**. | Low | XS |
| `packages/shared/src/result.ts:28` | `tryCatchAsync` | Async sibling of `tryCatch`. `tryCatch` is used 7×; `tryCatchAsync` has zero in-scope importers (and none in cli/tui). | Low | XS |
| `packages/shared/src/paths.ts:20` | `expandHome` | Path helper, zero importers anywhere. | Low | XS |
| `packages/shared/src/logger.ts:78` | `logger` (default singleton) | Every consumer calls `createLogger(...)` with explicit level/scope; the pre-built singleton is imported nowhere. | Low | XS |
| `packages/tools/src/index.ts:31` | `qualifiedToolName` | Exported helper; not referenced outside the tools package, not even in tools' own tests. | Low | XS |
| `packages/tools/src/git.ts` (re-exported `index.ts:19`) | `GitStatusEntry` (type) | Exported type with no consumer (incl. tools' own tests). | Low | XS |

### only-cli-tui (effectively dead for current focus)

| File:line | Symbol | Sole consumer | Effort to neutralize |
|-----------|--------|---------------|----------------------|
| `packages/contracts/src/events.ts:` (`NightcoreEventOf`) | `NightcoreEventOf<T>` | apps/tui (`session-reducer.ts`, `types.ts`) | n/a — keep until tui scope returns |
| `packages/contracts/src/models.ts:24` | `ModelDescriptor` / `ModelDescriptorSchema` | engine `listModels()` + tui pickers; **sidecar never calls `listModels()`** | n/a — keep |
| `packages/engine/src/session-manager.ts:132` | `SessionManager.listModels()` + `toModelDescriptor()` (`:21`) | only reachable from tui's model picker; not on the sidecar dispatch path | n/a — keep |

> Note: these are *correct* exports for when cli/tui re-enter scope. Listed so the build/forge agent does NOT delete them thinking they're orphaned, and so the user knows the contracts "dynamic model registry" half is currently inert in the desktop/web path.

### Rust — `#[allow(dead_code)]` parked seams (intentional, low value)

All 7 are documented "design seam for a future provider/diagnostic" and compile clean only because of the explicit allow. CONFIRMED-unused, but each carries a rationale — treat as *optional* removal, not a bug.

| File:line | Item | Stated reason |
|-----------|------|---------------|
| `apps/desktop/src-tauri/src/m2/coordinator.rs:687` | `type SharedNotify = Arc<Notify>` | "kept available for a future shared-handle path" |
| `apps/desktop/src-tauri/src/m2/provider.rs:46` | `Provider::ensure_started` (trait method) | "pins the seam for a future provider whose reader is self-contained" |
| `apps/desktop/src-tauri/src/m2/provider.rs:163` | `is_running()` | "diagnostic accessor for a future health/status command" |
| `apps/desktop/src-tauri/src/m2/provider.rs:289` | `task_for(session_id)` | "read-back accessor; kept for diagnostics and tests" |
| `apps/desktop/src-tauri/src/m2/slots.rs:78` | `attach_abort()` | "design-specified seam for a future provider whose run is a local task" |
| `apps/desktop/src-tauri/src/sidecar.rs:778` | `RunOutcome::NeedsApproval` variant | M4 approval-gate terminal (`park_for_approval` exists but variant is unconstructed) |
| `apps/desktop/src-tauri/src/logging.rs:26` | `LogGuard(WorkerGuard)` field | RAII drop-guard; field intentionally unread |

## Over-exported (symbol alive internally; only the PUBLIC export is unused)

These are **not** dead code — deleting the implementation would break the build. Only the barrel/façade re-export is redundant. Lowest-risk tidy-ups; each is a one-line removal from a barrel.

| Barrel:line | Re-export | Where it's actually used | Note |
|-------------|-----------|--------------------------|------|
| `packages/engine/src/index.ts:10-23` | `ToolRegistry`, `PermissionLayer`, `HookBus`, `SessionRunner`, `SessionRunnerConfig`, `resolveKindPreset`, `WRITE_TOOLS`, `KindPreset`, `PermissionPromptRequest`, `ApprovalDecision` | all consumed **only** internally via relative imports inside `packages/engine/src`; **`SessionManager` is the only façade export with an external consumer** (sidecar). `translateMessage`/`TranslateResult` are explicitly "exported for testing only". | The façade's own doc says "Surfaces import ONLY from here" — but in practice surfaces import only `SessionManager`. The rest widen the public API for nothing. |
| `apps/web/src/components/ui/index.ts:11` | `renderMarkdown` | used only inside `ui/Markdown.tsx` + its test | barrel re-export unused |
| `apps/web/src/components/ui/index.ts:15` + `ui/Modal/index.ts:3` | `useModal` | used only inside `ui/Modal/Modal.tsx` | re-exported twice, consumed externally zero times |

> `board/session-stream.ts` exports `TextEntry`/`ToolEntry` with no direct consumer, but they are **union members of `TimelineEntry`** (`session-stream.ts:54`), which *is* consumed. Load-bearing — do not remove. (`TaskEntry`, a third union member, is intentionally *not* barrel-exported — harmless inconsistency.) Same pattern protects every `*Command`/`*Event` member schema in contracts: each lacks a named importer but composes into `SurfaceCommandSchema`/`NightcoreEventSchema`, which the sidecar consumes. **None of the contracts union members are removal candidates.**

## Duplication to consolidate

### Model + effort option sets (web vs contracts)
**Files:** `apps/web/src/lib/models.ts` (`MODEL_OPTIONS`, `EFFORT_OPTIONS`, local `ModelOption`/`EffortOption` types) vs `packages/contracts/src/config.ts` (`KnownModelSchema:48`, `EffortLevelSchema:64`) and `models.ts` (`ModelDescriptorSchema`).
**Symptom of drift:** web has `claude-haiku-4-5-20251001`; contracts `KnownModelSchema` has `claude-haiku-4-5` (+ a `claude-fable-5` web doesn't list). Two sources of truth for "the known models" that already disagree.
**Re-export chain inflating the surface:** `@/lib/models` → re-exported by `board/status.ts:267` → re-exported again by `board/index.ts:35`. Three import paths to the same two arrays.
**Recommendation:** pick one source. Either (a) web imports the effort set from `@nightcore/contracts` (`EffortLevelSchema.options`) and keeps only the display labels locally, or (b) if the dynamic `listModels()` path stays deferred, delete the unused contracts `KnownModelSchema`/`ModelDescriptorSchema` and let `lib/models.ts` be the single web-side source. Do **not** keep both. Effort: S. Risk: Low (types are structurally compatible string unions).

### Web `TaskKind` re-declaration
**File:** `apps/web/src/lib/bridge.ts:42` declares `export type TaskKind = 'build' | 'research' | 'review' | 'decompose'` — byte-identical to `packages/contracts/src/config.ts:31` `TaskKindSchema`.
**Recommendation:** `import type { TaskKind } from '@nightcore/contracts'` (web already imports contracts in this file, `bridge.ts:4`). Effort: XS. Risk: Low.
**Not duplication (leave as-is):** `bridge.ts` `TaskStatus`, `RunMode`, `PermissionMode` mirror the **Rust** serde enums, not contracts — `PermissionMode` (`bypass|auto-accept|ask|plan`) is a deliberately different UI vocabulary from the SDK's `PermissionModeSchema` (`default|acceptEdits|bypassPermissions|…`) and there is a real mapping layer. These are intentional boundary restatements.

### No duplication found where the brief suspected it
- **`which`/binary resolver:** clean. `packages/engine/src/resolve-claude-binary.ts:31` reuses `shared.whichSync`; the Rust side has its own single `platform::resolve_program` (`apps/desktop/src-tauri/src/platform/mod.rs`) — different language boundary, not a duplicate.
- **id generator / Result / logger:** single canonical home in `@nightcore/shared`; no reimplementation in engine/tools/desktop/web.

## Whole-package verdicts (file/dependency level; subsystem call is arch's)

| Package | In-scope live consumer? | Verdict |
|---------|------------------------|---------|
| `@nightcore/contracts` | yes — sidecar + web + engine | **wired** (some members inert, see only-cli-tui) |
| `@nightcore/shared` | yes — engine/config/storage/sidecar | **wired** (3 dead leaf exports above) |
| `@nightcore/config` | yes — **sidecar** imports `resolveConfig` (`apps/sidecar/src/index.ts:26`) | **wired** — but wrongly listed as an `engine` dep |
| `@nightcore/storage` | yes — engine `session-manager.ts:10` (`SessionStore`) | **wired** |
| `@nightcore/skills` | yes — engine `agent-presets.ts:9` → `nightcoreAgents` → `Options.agents` (`session-runner.ts:326`, live) | **wired** |
| `@nightcore/tools` | **no live reach** — feeds only `buildSdkMcpServer()` (never called) and `descriptors()` (never reached via `riskOf`) | **dead weight in runtime; parked for later removal per M4.7 §A2** |
| `@nightcore/mcp` | **no live reach** — `externalMcpServers` feeds only `descriptors()` | **dead weight in runtime** (empty array + parked) |
| `@nightcore/eslint-plugin` | build/lint tool, run via `eslint.config.mjs` | **wired** (tooling, not runtime) |

## Unused dependencies (package.json)

| Package | Dep | Evidence | Fix |
|---------|-----|----------|-----|
| `packages/engine` | `@nightcore/config` (`package.json:16`) | no `import ... from '@nightcore/config'` in engine src or tests — only comment mentions | remove from engine deps (config is the sidecar's dep) — XS, Low risk |
| `packages/engine` | `@nightcore/tools`, `@nightcore/mcp` | imported (`tool-registry.ts`) but the importing code is itself unreachable | keep the dep entry until the tools/mcp subsystem decision is made (arch) |

All web runtime deps (`dompurify`, `lucide-react`, `marked`, `@tauri-apps/plugin-dialog`) are imported and live. No obviously-unused devDeps found.

## What NOT to touch

- **Contracts union members** (`StartSessionCommand`, `SendInputCommand`, every `*Event`/`*Command`, `TokenUsageSchema`, `ConfigPathsSchema`, etc.). They have no named importer but compose into `SurfaceCommandSchema`/`NightcoreEventSchema`/`ConfigSchema`, which ARE consumed live. Deleting any breaks the wire contract.
- **`TextEntry`/`ToolEntry`** (web) — union members of the consumed `TimelineEntry`.
- **only-cli-tui symbols** (`listModels`, `ModelDescriptor`, `NightcoreEventOf`) — correct API for when cli/tui re-enter scope.
- **Rust `#[allow(dead_code)]` seams** — each is a documented future hook; only remove if the user wants to drop those reserved features.
- **`board/_fixtures.ts`** — test/story-only fixture, correctly not shipped (consumed solely by `.test.tsx`/`.stories.tsx`). Not dead.

## Implementation order (safest first)

1. **XS, zero-risk leaf deletions** (no internal users, no external users):
   `KnownModelSchema`/`KnownModel`, `SurfaceCommandOf`, `tryCatchAsync`, `expandHome`, `shared logger` singleton, `qualifiedToolName`, `GitStatusEntry`. Typecheck after; each is independent.
2. **XS dependency fix:** drop `@nightcore/config` from `packages/engine/package.json` deps. Run `bun install` + `tsc -b`.
3. **XS duplication fix:** `apps/web/src/lib/bridge.ts` import `TaskKind` from `@nightcore/contracts` instead of re-declaring.
4. **S duplication consolidation:** unify model/effort option source (web `lib/models.ts` ↔ contracts `EffortLevelSchema`/`ModelDescriptorSchema`); resolve the haiku-id drift while you're there. Touches web + possibly contracts. Run web tests + typecheck.
5. **Optional, S:** trim the `@nightcore/engine` façade (`index.ts`) to just `SessionManager` (+ the test-only `translateMessage` if tests need it). Internal relative imports already cover the rest.
6. **Deferred / arch-coordinated, L:** removing `@nightcore/tools` + `@nightcore/mcp` and the dead `ToolRegistry.buildSdkMcpServer/mcpServers/descriptors` methods. This is a subsystem removal (10 tool files, 2 packages, their tests, engine deps, and the `nightcoreToolDescriptors`/`riskOf` path simplification). Do NOT start before arch confirms the "native-tools-only" decision is permanent.

## Effort / risk / value

| Change | Effort | Risk | Value |
|--------|--------|------|-------|
| Delete 7 confirmed-dead leaf exports | XS | Low | Low |
| Remove `@nightcore/config` from engine deps | XS | Low | Low (correctness/clarity) |
| web `TaskKind` → import from contracts | XS | Low | Med (kills drift vector) |
| Consolidate model/effort sources | S | Low | High (fixes existing id drift) |
| Trim engine façade to `SessionManager` | S | Low | Med (narrows public API) |
| Remove tools+mcp subsystem | L | Med–High | High (deletes 2 pkgs + 10 files) — **arch-gated** |
| Remove Rust dead-code seams | S | Low | Low (intentional seams) |

## Cross-lens (hand to kirei-arch — do not action here)

- **Tools/MCP subsystem is architecturally unwired** (custom MCP server disabled M4.7 §A2). Whether to delete vs keep-parked is a wiring decision arch owns; this report only inventories the file/export fallout.
- **`SessionManager.listModels()` is unreachable from the desktop/web path** — the dynamic model registry (contracts `ModelDescriptor`) is an island reachable only from tui. Arch should map whether desktop/web are *meant* to call it.
- **Reserved task kinds** `research`/`decompose` (`packages/contracts/src/config.ts:34`, `engine/src/kind-presets.ts:58`) are defined but carry no preset overrides / aren't fully driven — defined-not-wired, arch's call.
