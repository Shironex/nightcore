//! Persistence of the last ON-DEMAND armed-checks run (Checks Manager, T7).
//!
//! The armed-checks gauntlet already runs during task verification (its result is
//! stored per-task on `Task.structure_lock_result`). The Enforce panel's "Run
//! armed checks now" is a project-scoped, task-less run — so its result lives in a
//! tiny project-local file, `<project>/.nightcore/checks-last-run.json`, and the
//! panel reads it back on mount to show each check's LAST result (and the run-level
//! pass/fail + timestamp) without re-running. `.nightcore/` is gitignored, so this
//! is transient local state, never committed.
//!
//! Lenient read (absent/malformed ⇒ `None`, mirroring the policy reader), atomic
//! write (temp + rename), server-resolved path (the active project) — the exact
//! posture of the other single-file stores.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::store::types::StructureLockResult;

/// The project-relative path of the last on-demand run record.
const LAST_RUN_REL_PATH: &str = ".nightcore/checks-last-run.json";

fn last_run_file(project_path: &str) -> PathBuf {
    Path::new(project_path).join(LAST_RUN_REL_PATH)
}

/// The persisted last on-demand run: the full gauntlet result plus when it ran
/// (ms since epoch). Serde-only (internal transient state, not a ts-rs boundary
/// type); the command layer projects it into the web-facing `ArmedChecksState`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct StoredArmedChecksRun {
    pub(crate) ran_at: u64,
    pub(crate) result: StructureLockResult,
}

/// Persist the last on-demand run for `project_path`, overwriting any prior record.
/// Best-effort atomic write; creates `.nightcore/` when absent.
pub(crate) fn write_last_run(
    project_path: &str,
    result: &StructureLockResult,
    ran_at: u64,
) -> Result<(), String> {
    let path = last_run_file(project_path);
    let stored = StoredArmedChecksRun {
        ran_at,
        result: result.clone(),
    };
    let json = serde_json::to_string_pretty(&stored)
        .map_err(|e| format!("failed to serialize checks-last-run: {e}"))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
    }
    crate::store::write_atomic(&path, json.as_bytes())
        .map_err(|e| format!("failed to write {}: {e}", path.display()))
}

/// Read the last on-demand run for `project_path`. Lenient: an absent or malformed
/// record yields `None` (the panel simply shows "not run yet"), never an error.
pub(crate) fn read_last_run(project_path: &str) -> Option<StoredArmedChecksRun> {
    let raw = std::fs::read_to_string(last_run_file(project_path)).ok()?;
    match serde_json::from_str(&raw) {
        Ok(run) => Some(run),
        Err(e) => {
            tracing::warn!(
                target: "nightcore::checks_manager",
                error = %e,
                "malformed .nightcore/checks-last-run.json; ignoring the last-run record"
            );
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::types::{StepStatus, StructureLockCheck};

    fn root_of(tmp: &tempfile::TempDir) -> String {
        tmp.path().to_string_lossy().to_string()
    }

    fn sample_result() -> StructureLockResult {
        StructureLockResult {
            passed: false,
            failed_check: Some("lint".into()),
            checks: vec![StructureLockCheck {
                name: "lint".into(),
                kind: "lint-plugin".into(),
                command: "npx eslint .".into(),
                status: StepStatus::Failed,
                exit_code: Some(1),
                output: Some("boom".into()),
                duration_ms: Some(1200),
            }],
        }
    }

    #[test]
    fn write_then_read_round_trips() {
        let tmp = tempfile::TempDir::new().expect("temp dir");
        assert!(read_last_run(&root_of(&tmp)).is_none(), "absent ⇒ None");
        write_last_run(&root_of(&tmp), &sample_result(), 1_700_000_000_000).expect("write");
        let run = read_last_run(&root_of(&tmp)).expect("present");
        assert_eq!(run.ran_at, 1_700_000_000_000);
        assert!(!run.result.passed);
        assert_eq!(run.result.checks[0].name, "lint");
        assert_eq!(run.result.checks[0].duration_ms, Some(1200));
    }

    #[test]
    fn malformed_record_reads_as_none() {
        let tmp = tempfile::TempDir::new().expect("temp dir");
        let nc = tmp.path().join(".nightcore");
        std::fs::create_dir_all(&nc).expect("mkdir");
        std::fs::write(nc.join("checks-last-run.json"), "{ not json").expect("write");
        assert!(read_last_run(&root_of(&tmp)).is_none(), "malformed ⇒ None");
    }
}
