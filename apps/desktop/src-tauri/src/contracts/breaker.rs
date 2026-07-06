//! The immediate-trip classifier for the circuit breaker.
//!
//! Homed in `contracts` (rank 1) beside its only input type ([`ErrorCategory`], a
//! rank-1 contract) so BOTH the sidecar reader and the orchestration breaker import
//! it DOWNWARD — keeping the `Arc<dyn EngineApi>` seam free of a
//! sidecar→orchestration back-edge. Lifted out of `contracts/mod.rs` into this
//! sibling so the module stays a manifest (issue #17 phase D).

use super::ErrorCategory;

/// Whether a failure of this structured [`ErrorCategory`] should trip the breaker
/// IMMEDIATELY rather than accumulate toward the sliding-window threshold. A
/// fatal-setup cause won't fix itself by running more tasks — auth is broken for
/// every task under the same credential, and a full disk fails every write — so
/// the loop stops at once instead of burning two more tasks proving the point.
/// Transient causes (rate-limit, runner-crash, unknown) keep the tolerant window
/// so a single blip doesn't pause the board. `aborted`/`resource-exhausted` never
/// reach this decision as breaker-feeding failures (they're handled upstream), but
/// are classified conservatively as non-immediate for exhaustiveness.
pub(crate) fn trips_breaker_immediately(category: ErrorCategory) -> bool {
    matches!(category, ErrorCategory::Auth | ErrorCategory::DiskFull)
}
