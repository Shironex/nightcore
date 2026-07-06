//! Rust→TS binding codegen (rank 6) — the ts-rs export aggregator.
//!
//! The inverse of `contracts::generated` (zod→Rust): each `#[derive(TS)]`
//! boundary type writes its `.ts` binding into `apps/web/src/lib/generated/` when
//! `cargo test` runs, and the web bridge imports them. This module is the single
//! named umbrella that exports every boundary type in one call, plus the drift
//! guard that asserts the emitted tree is clean.
//!
//! Homed at the TOP rank (issue #17 phase A.4) precisely because it legitimately
//! references types across EVERY tier (contracts, store, worktree, workflow,
//! sidecar, commands, …). It previously lived in `contracts/ts_bindings.rs`, which
//! forced `contracts` — the rank-1 leaf — to carry cross-tier references. Moving it
//! here lets `contracts` be an exemption-free leaf; `bindings/**` is the one module
//! `rust-layer-rank` exempts (it aggregates all tiers by design).
//!
//! Test-only: the `#[ts(export)]` codegen + its drift guard run under `cargo test`,
//! never in the shipped binary — so the submodule is `#[cfg(test)]` and the release
//! build compiles this to nothing.

#[cfg(test)]
mod export;
