# @nightcore/desktop — Agent Contract

Read this before editing. Hard guardrails enforced by `bun run lint`, `bun run test:all`, and `tools/lint-meta`. Severity is **error or off, never warn**.

## Orchestration & boundaries
- ALL orchestration lives in the desktop core (Rust/Tauri); the sidecar stays a dumb relay. Do not push decision logic into the sidecar.
- This surface reaches the model ONLY through the `@nightcore/engine` façade — never import `@anthropic-ai/claude-agent-sdk` directly (enforced by `no-restricted-imports`).
- `apps/web` talks to this core ONLY through `lib/bridge.ts` (the single Tauri seam). Keep components Tauri-import-free.

## Contracts & codegen — regenerate, never hand-edit
- `src-tauri/src/contracts/generated.rs` is generated from `@nightcore/contracts` zod via `bun run codegen:contracts`; the `codegen-drift` lint-meta rule fails CI on any non-codegen diff. Change the schema and regenerate.
- Persisted/wire structs are serde-additive: every new field is `Option` with a `None` default in its own additive block, the struct carries `#[serde(rename_all = "camelCase")]`, and the change ships a field-absent pinning test PLUS an exact-wire-string round-trip test over every variant.

## Degrade, don't throw
- At the session/runtime boundary, errors become `session-failed` events; `run()` never rejects and session ids are never reused.

## Rust lint & test
- Before pushing Rust changes, run `cargo fmt --check` and `cargo clippy -- -D warnings` in `src-tauri`. This is a convention, not a `bun run lint` gate: `lint`/`lint:meta` run in the Bun workspace job, which carries no Rust toolchain or Tauri system deps — folding `cargo clippy` there would break that job. Rust compiles in the separate `rust-checks` CI job (`test:rust`).
- The authoritative test gate is `bun run test:all` (it includes `test:rust`); plain `test` omits the Rust suite.

## Rust module structure (enforced by lint-meta, issue #17)
These are pure text rules in `tools/lint-meta` (the Bun lint job — never `cargo`):
- `rust-module-shape`: every `mod.rs` under `src-tauri/src/**` is a manifest — only `mod`/`use` declarations, docs, and attributes; a top-level `fn`/`impl`/`struct`/`enum`/`trait`/`const`/`macro_rules!` body belongs in a sibling file, re-exported (house pattern: `worktree/mod.rs`). Plus a **400 code-line cap** per file, measured EXCLUDING `#[cfg(test)]` blocks (inline tests are ~37% of the crate; sibling `tests.rs` files are not counted). ENFORCED via a shrinking ratchet (`baselines/rust-module-shape.json`): today's god-files + logic-bearing `mod.rs` are grandfathered, but a new over-cap file, a `mod.rs` that gains logic, or a grandfathered file that GROWS past its frozen value fails CI. Split an offender, then `bun run lint:meta -- --update-baseline` to lower its entry — never raise it. Do NOT introduce a sibling `tests.rs` to dodge the cap; keep the inline `#[cfg(test)]` convention. Permanent exemptions (never counted, not debt): `contracts/generated.rs`, `store/run_store.rs`, `sidecar/harness/apply.rs`.
- `rust-layer-rank`: `crate::X` imports point strictly DOWN a 6-tier rank — `contracts`/`infra`/`sync`/`engine_api` (1) → `git` (2) → `store`/`worktree`/`provider` (3) → `analysis` (4) → `orchestration`/`sidecar`/`workflow` (5, the engine SCC) → `commands` (6). Facades are resolved (`crate::task`→`store`, `crate::merge`/`gauntlet`/`plan_approval`→`workflow`, `crate::platform`/`logging`/`proc`→`infra`), so route a new cross-tier need through a façade/seam, never a raw upward/sideways `use`. The engine SCC tolerates sideways imports among its three members EXCEPT the two seam-guarded edges: `sidecar → orchestration` (the sidecar reaches the engine only through `Arc<dyn EngineApi>`) and `workflow → sidecar` (workflow reaches session dispatch only through `Arc<dyn SessionDispatch>`; the injection fence lives in `infra::untrusted` — audit #33). Exempt: `lib.rs` and `bindings/**`.
- `rust-command-placement`: no `#[tauri::command]` in the leaf tier (`contracts`/`infra`/`sync`/`git`/`engine_api`/`store`/`worktree`/`provider`) — a handler belongs in `commands/` (core entities) or co-located in its feature/engine module (`sidecar`/`workflow`). Deliberately NOT a "commands/-only" rule; 119/120 handlers already comply.
- `rust-engine-seam`: nothing under `sidecar/**` may `use crate::orchestration::…` — reach the engine only through the `Arc<dyn EngineApi>` seam (`engine_api`). A direct import re-closes the cycle the 2026-06-28 decomposition broke.

## Rust architecture guards (cargo-side, audit #38)
Enforced by `cargo test` (`src-tauri/src/arch_guards.rs`) and the `rust-checks` CI job — the cargo-side complement of the lint-meta rules above:
- **Layer guard tests**: `worktree/` imports only `crate::git`/`crate::infra`; `git/` only `crate::infra`; `workflow/` never `crate::sidecar`; `sidecar/` never `crate::orchestration`. Route a new cross-tier need through a seam (`engine_api::EngineApi` / `engine_api::SessionDispatch`), never a raw import.
- **Sync-command allowlist**: a synchronous `#[tauri::command] fn` runs on the WKWebView main thread (the commit-button-freeze class). Every sync command must be listed in `arch_guards`' `SYNC_COMMAND_ALLOWLIST` (exact match — stale entries fail too). New commands default to `async fn` + `tauri::async_runtime::spawn_blocking` + `try_state` re-acquire (see `commit_task`).
- **Command-home rule** (see `commands/mod.rs`): feature-local `#[tauri::command]`s are blessed — a command lives WITH its feature (`sidecar/*`, `workflow/*`, `orchestration/coordinator`, `analysis/`); `commands/` is reserved for cross-layer glue that must touch both persistence and orchestration. `lib.rs`'s `generate_handler!` lists every command in its feature group.
- **Clippy ratchets** (the `rust-checks` job, never lint-meta): `-W clippy::await_holding_lock` and `-W clippy::unwrap_used` ride on `-D warnings`; tests may unwrap (`clippy.toml: allow-unwrap-in-tests`).
