//! The hand-written `TaskKind` — the Rust→ts-rs source for the web's
//! `TaskKind.ts`, and the type stored on `Task.kind`.
//!
//! Homed in `contracts` (rank 1) because `TaskKind` is a wire/contract enum, not
//! a store concern (issue #17 phase A.3b — it previously lived in `store::task`,
//! which made the `contracts` parity guard reach UP into `store`). It is the
//! THIRD authoring of the kind vocabulary — the zod `TaskKindSchema` and the
//! zod→Rust [`generated::TaskKind`](super::generated) are the other two; the
//! parity guard in [`super`] asserts this copy and the generated one carry the
//! same variant/wire set, so adding a kind must touch every site.
//!
//! Deliberately NOT re-exported at the `contracts` module root: the glob
//! `pub use generated::*` already binds `contracts::TaskKind` to the wire enum
//! (`provider` imports it as `WireTaskKind`), so this copy is reached via its
//! submodule path and back-compat re-exported at `crate::task::TaskKind`.

use serde::{Deserialize, Serialize};
// `ts-rs` is a DEV-dependency (the Rust→TS codegen runs only under `cargo test`),
// so its derive + attributes are gated behind `cfg(test)` via `cfg_attr`. The
// shipped binary never links it.
#[cfg(test)]
use ts_rs::TS;

/// The kind of work a task represents (M4 §A). The shared contract between the
/// Rust core (which owns each kind's ORCHESTRATION policy in `kind.rs`) and the
/// engine (which owns its AGENT DEFINITION). `build` is the default and reproduces
/// pre-M4 behavior; `tdd` is a build-like test-first variant; `decompose` proposes
/// sub-tasks; `research` investigates read-only; `review` is the internal
/// verification reviewer's identity (not user-selectable in the picker).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "snake_case")]
#[cfg_attr(test, ts(export, export_to = "TaskKind.ts"))]
pub enum TaskKind {
    #[default]
    Build,
    Research,
    Review,
    Decompose,
    /// Test-first build: the agent writes a failing test, then implements until
    /// green. Orchestrated identically to `Build` (own worktree + verification);
    /// only the engine's AGENT DEFINITION (the test-first persona) differs.
    Tdd,
}

impl TaskKind {
    /// The snake_case wire string the provider sends in `start-session` and the
    /// engine resolves to an agent preset.
    pub fn as_wire(&self) -> &'static str {
        match self {
            TaskKind::Build => "build",
            TaskKind::Research => "research",
            TaskKind::Review => "review",
            TaskKind::Decompose => "decompose",
            TaskKind::Tdd => "tdd",
        }
    }
}
