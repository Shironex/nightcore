# Debug Report: Tasks stuck in "In Progress" — sidecar `bun` spawn fails silently on Windows

**Date:** 2026-06-21
**Agent:** kirei-debug
**Status:** root cause confirmed

## Symptom
Starting a task moves it to the "In Progress" column, but nothing happens: no visible work, no output, no error, no transition to Failed. The rolling log file goes silent after:

```
2026-06-21T21:05:27.359868Z  INFO nightcore: ensuring sidecar is up
```

No `sidecar spawned (bun)`, no `session ready`, no `run failed` line ever follows. The boot lines confirm tasks repeatedly strand in InProgress across restarts:

```
INFO nightcore: requeued crash-stranded task to Ready task_id=eb1307d6-... from=InProgress
INFO nightcore: boot reconciliation requeued stranded tasks requeued=1
```

The app was originally developed/run on macOS and is now run on Windows 11. macOS to Windows cross-platform issue.

## Expected
Starting a task spawns the Bun sidecar, the engine begins a session, events stream to the board, and the task progresses (or fails with a visible error/log).

## Repro
**Faithful Rust repro of the exact spawn call** (`apps/desktop/src-tauri/src/m2/provider.rs:177`):

```rust
use std::process::{Command, Stdio};
fn main() {
    Command::new("bun")
        .arg("run").arg(r"X:\nightcore\apps\sidecar\src\index.ts")
        .current_dir(r"X:\nightcore")
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .spawn(); // -> Err(NotFound) "program not found"
}
```

Result on this Windows machine:
```
SPAWN ERR kind=NotFound msg=program not found
```

**Reliability:** Always (deterministic) on this Windows install. Never on macOS.

## Root Cause
**Location:** `apps/desktop/src-tauri/src/m2/provider.rs:177` — `Command::new("bun").arg("run").arg(&self.entry)...spawn()`

**Mechanism:** On Windows, Rust's `std::process::Command` / `tokio::process::Command` resolve the program name through the Win32 `CreateProcess` API, which only finds true executables (`.exe`/`.com` via `PATHEXT`) on `PATH`. On this machine the only `bun` entries on `PATH` are npm shims — `bun` (a POSIX shell script), `bun.cmd` (batch), `bun.ps1` (PowerShell) at `C:\Users\shirone\AppData\Roaming\npm\` — while the real `bun.exe` lives in a non-`PATH` directory (`...\npm\node_modules\bun\bin\bun.exe`). `CreateProcess` cannot launch a `.cmd`/`.ps1`/extensionless shim directly, so `spawn()` returns `Err(NotFound)` and the sidecar never starts.

**Why it is silent + stranded (the second half of the bug):** the MANUAL run path `run_task` (`apps/desktop/src-tauri/src/sidecar.rs`) mutates the task to `InProgress` and emits it (lines 864-881) BEFORE calling `ensure_reader` (line 883). On the `ensure_reader` error it only releases the slot and `return Err(e)` (lines 883-886) — it does NOT reset the task status (leaves it stuck in InProgress) and emits NO `tracing` log, so the log file shows nothing after "ensuring sidecar is up". (The auto-loop `launch` path at `coordinator.rs:350` DOES handle this — it calls `fail_task` and orders `ensure_reader` before the InProgress mutation — so the visible "stranded-with-no-error" symptom is specifically the manual start path.)

**Introduced by:** predates current history as a latent cross-platform assumption (the doc comment at `m2/provider.rs:146` literally says "spawn `bun run <entry>`"). Surfaced now only because the app moved macOS to Windows. n/a single commit.

## Evidence
- Faithful Rust repro of `provider.rs:177` returns `SPAWN ERR kind=NotFound msg=program not found` on this Windows machine.
- PATH inspection: `C:\Users\shirone\AppData\Roaming\npm\` contains `bun` (POSIX shell script), `bun.cmd`, `bun.ps1`, but NO `bun.exe`. The real `bun.exe` is at `...\npm\node_modules\bun\bin\bun.exe` (not on PATH).
- Reverse-test (proves the mechanism): `Command::new(r"...\node_modules\bun\bin\bun.exe").arg("--version").spawn()` -> `SPAWN OK`; `Command::new("cmd").arg("/c").arg("bun").arg("--version").spawn()` -> `SPAWN OK`. Only the bare `Command::new("bun")` fails. The cause predicts on/off exactly: a directly-launchable `bun.exe` works, the shim name does not.
- `apps/desktop/src-tauri/target/debug/nightcore.exe` was built today on Windows (23:03), so `env!("CARGO_MANIFEST_DIR")` resolves to the correct Windows path — the entry path is NOT the problem (this rules out the stale-Mac-path / externalBin hypotheses).

## Recommended Fix
**Approach:** Resolve the Bun executable in a Windows-aware way instead of relying on a bare `"bun"` name that `CreateProcess` cannot find. Preferred option: locate a real launchable binary (`bun.exe`) and spawn that by absolute path; fall back to routing through the shell shim. Also harden the manual `run_task` error path so a spawn failure is logged and the task does not strand in InProgress.

**Files to change:**
- `apps/desktop/src-tauri/src/m2/provider.rs:177` — replace `Command::new("bun")` with a resolved program. Options, in order of robustness:
  1. Resolve `bun.exe` via a PATH-and-extension-aware lookup (e.g. the `which` crate) and `Command::new(resolved_path)`. This finds `bun.exe` even when only the shim's sibling is on PATH, and stays correct on macOS/Linux.
  2. As a Windows-specific fallback, spawn through the shim: under `cfg!(windows)` use `Command::new("cmd").args(["/C", "bun", "run", entry])` (or invoke `bun.cmd` directly). Note `cmd /C` inserts a wrapper process between the core and the sidecar — interrupt/kill must target the child tree, so option 1 is cleaner.
  - Make the error message actionable: state that no launchable `bun.exe` was found on PATH (the current "is `bun` on PATH?" is misleading on Windows where the shim IS on PATH but isn't launchable by CreateProcess).
- `apps/desktop/src-tauri/src/sidecar.rs:883-886` — on `ensure_reader` failure in `run_task`, before returning: emit `tracing::error!(target: "nightcore", ...)` and reset the task out of `InProgress` (set `Failed` with the error, reusing the coordinator's `fail_task` semantics) so it does not strand in the "In Progress" column with no log. Consider mirroring `coordinator::launch`'s ordering (ensure the sidecar BEFORE the InProgress mutation) so a dead sidecar never paints the task as running.

## Regression Test to Promote
A unit test cannot fully exercise `CreateProcess` portability, but the resolver should be factored into a pure, testable helper. Promote this once the fix introduces a `resolve_bun_program()` helper:

```rust
// apps/desktop/src-tauri/src/m2/provider.rs  (in #[cfg(test)] mod tests)
#[test]
#[cfg(windows)]
fn bun_resolves_to_a_launchable_binary_on_windows() {
    // The bug: Command::new("bun") fails with NotFound on Windows because only
    // bun.cmd/bun.ps1 shims are on PATH, not a launchable bun.exe. The resolver
    // must return a program CreateProcess can actually spawn (a .exe path, or a
    // shell-routed invocation) — never the bare "bun" name.
    let resolved = super::resolve_bun_program(); // new helper introduced by the fix
    assert!(
        std::process::Command::new(&resolved.program)
            .args(&resolved.prefix_args)
            .arg("--version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .is_ok(),
        "resolved bun program must be spawnable via CreateProcess: {resolved:?}"
    );
}
```

Plus a cross-platform smoke test that `resolve_bun_program()` returns a value (bun is a build prerequisite) on the CI host.

## Instrumentation to Remove
None — diagnosed from existing logs plus an out-of-tree faithful Rust repro (compiled under /tmp, already deleted). No production source files were instrumented or modified.

## Risks
- Routing through `cmd /C` (the fallback option) inserts a wrapper process: the existing detached-`Child` keep-alive in `spawn()` (provider.rs:195-198) would then own the `cmd` shell, not the real bun process. Verify ownership/teardown if that path is taken. (Interrupts already go through the engine `interrupt` SurfaceCommand over stdin, so process-tree kill is less critical, but worth confirming.)
- The resolver must keep working on macOS/Linux (where bare `bun` already resolves). Gate Windows-specific logic behind `cfg!(windows)` or use a cross-platform resolver that returns the bare name when it is directly launchable.
- Fixing only the spawn (not the manual-path stranding) changes the symptom from "silent stranded InProgress" to "task flips to Failed". Apply BOTH changes so the failure is visible AND the task does not strand.

## How to Verify the Fix
1. Apply the fix (resolver in provider.rs + error handling in run_task).
2. Confirm no instrumentation remains (there was none).
3. Run the new regression test — must pass on Windows.
4. Re-run the repro: starting a task on Windows must now spawn the sidecar (`sidecar spawned (bun)` appears in the log) and the task progresses; OR, if bun is genuinely absent, the task must transition to Failed with a clear logged error — never strand silently in InProgress.
