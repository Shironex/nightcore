//! The Tauri command layer.
//!
//! Command handlers that legitimately depend on BOTH the persistence layer
//! ([`crate::store`]) and orchestration ([`crate::orchestration`]) live here, so
//! the `store/` modules can stay pure persistence leaves with no up-calls into
//! orchestration. Phase 2 moves the TASK command family here first; the `project`
//! and `settings` families follow in later passes.

pub mod task;
