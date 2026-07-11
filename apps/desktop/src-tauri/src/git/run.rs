//! The shared git subprocess runners + the bounded-subprocess core.
//!
//! Every git spawn in the crate builds on the git-env isolation chokepoint
//! `platform::git_command` (which scrubs the `GIT_*` + code-execution env
//! vectors and neutralizes repo-local exec config). These helpers add the common
//! spawn → status-check → trim discipline on top so consumers stop re-rolling it.
//!
//! [`drain_and_wait`] is the ONE bounded-subprocess core shared by the three
//! network/hang-prone runners that used to each re-implement the drained-pipe +
//! deadline + kill dance: the git `git_with_deadline` here, the `gh` seam
//! (`git::gh`), and the `claude -p` one-shot (`workflow::oneshot`). It owns
//! ONLY the drain/deadline/kill mechanics —
//! each caller keeps its own env-configured spawn (so the git-env chokepoint, the
//! gh credential path, and claude's least-privilege arg building all stay
//! bespoke) and its own outcome mapping.

use std::io::{Read, Write};
use std::path::Path;
use std::process::Child;
use std::time::Duration;

/// The drained output of a bounded subprocess run (see [`drain_and_wait`]).
pub(crate) struct BoundedOutput {
    pub(crate) status: std::process::ExitStatus,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
}

/// Feed an already-spawned `child` its `stdin_payload` (from a detached thread so
/// a large body can't deadlock against a child that is also writing output),
/// drain BOTH its stdout and stderr pipes on threads (so neither can fill and
/// block the child), and wait under `deadline` via [`crate::proc::wait_with_deadline`]
/// (which kills + reaps on overrun, closing the pipes so the drain threads finish).
///
/// Returns:
/// - `Ok(Some(BoundedOutput))` — the child exited within the deadline;
/// - `Ok(None)` — the deadline elapsed (child killed + reaped);
/// - `Err(e)` — the wait itself failed (child killed + reaped).
///
/// The caller owns the spawn: it sets the command's env/cwd/args and its stdio
/// piping, so a pipe configured as `Stdio::null()` (e.g. claude's stderr) simply
/// drains to an empty string. This is the shared half of the git/gh/claude
/// bounded runners; the caller maps the three arms to its own error/None posture.
pub(crate) fn drain_and_wait(
    mut child: Child,
    stdin_payload: Option<&[u8]>,
    deadline: Duration,
) -> std::io::Result<Option<BoundedOutput>> {
    // Feed stdin from a detached thread (dropping the handle closes the pipe / EOF).
    if let (Some(payload), Some(mut stdin)) = (stdin_payload, child.stdin.take()) {
        let payload = payload.to_vec();
        std::thread::spawn(move || {
            let _ = stdin.write_all(&payload);
        });
    }

    fn drain<R: Read + Send + 'static>(pipe: Option<R>) -> std::thread::JoinHandle<String> {
        std::thread::spawn(move || {
            let mut buf = String::new();
            if let Some(mut p) = pipe {
                let _ = p.read_to_string(&mut buf);
            }
            buf
        })
    }
    let stdout = drain(child.stdout.take());
    let stderr = drain(child.stderr.take());

    match crate::proc::wait_with_deadline(&mut child, deadline)? {
        Some(status) => Ok(Some(BoundedOutput {
            status,
            stdout: stdout.join().unwrap_or_default(),
            stderr: stderr.join().unwrap_or_default(),
        })),
        None => Ok(None),
    }
}

/// Run a git subcommand in `repo`, returning trimmed stdout on success or the
/// trimmed stderr as the error. The unbounded runner every non-network git read
/// routes through (the network ones use [`git_with_deadline`]).
pub(crate) fn git(repo: &Path, args: &[&str]) -> Result<String, String> {
    let out = crate::platform::git_command(repo)
        .args(args)
        .output()
        .map_err(|e| format!("failed to run git (is `git` on PATH?): {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Run a git subcommand in `dir` for its trimmed stdout, `None` on any failure —
/// a spawn error OR a non-zero exit. Callers that gate on git output treat every
/// `None` as "skip". Thin [`git`]`.ok()` wrapper, so it shares the exact
/// chokepoint + trim discipline; a successful-but-empty read returns
/// `Some(String::new())` (map with `.filter(|s| !s.is_empty())` for empty-as-absent).
pub(crate) fn git_stdout(dir: &Path, args: &[&str]) -> Option<String> {
    git(dir, args).ok()
}

/// Like [`git`], but bounded by a wall-clock `deadline` — for subcommands that
/// talk to the NETWORK (`push`, `fetch`), where a black-holed origin would
/// otherwise pin the calling blocking thread (and any task lease it holds)
/// forever. Same chokepoint (`platform::git_command`, so the git-env isolation is
/// preserved), spawned with piped output drained + reaped via the shared
/// [`drain_and_wait`] core; on overrun the child is killed and `timeout_msg` is
/// returned as the error.
pub(crate) fn git_with_deadline(
    repo: &Path,
    args: &[&str],
    deadline: Duration,
    timeout_msg: &str,
) -> Result<String, String> {
    use std::process::Stdio;
    let child = crate::platform::git_command(repo)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to run git (is `git` on PATH?): {e}"))?;
    match drain_and_wait(child, None, deadline) {
        Ok(Some(out)) if out.status.success() => Ok(out.stdout.trim().to_string()),
        Ok(Some(out)) => Err(out.stderr.trim().to_string()),
        Ok(None) => Err(timeout_msg.to_string()),
        Err(e) => Err(format!("git did not finish: {e}")),
    }
}

/// Run a git subcommand purely for its exit status (no output capture). Returns
/// true on success. Used for predicate-style git calls (`diff --quiet`, `merge`).
pub(crate) fn git_status_success(repo: &Path, args: &[&str]) -> bool {
    crate::platform::git_command(repo)
        .args(args)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

// The bounded-subprocess core (`drain_and_wait`) is exercised with plain `sh`
// children (no git needed) so the anti-deadlock + deadline behavior is tested in
// isolation; the `git_with_deadline` overrun test uses a real git op against a
// local black-hole listener. Unix-only: the fixtures use `sh`/`yes`.
#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    use std::time::Instant;

    /// Run `body` on its own thread bounded by `limit`, panicking (failing the test
    /// FAST) if it doesn't finish in time. A drain-deadlock regression would otherwise
    /// hang until the CI-wide test timeout; this reds it in seconds instead.
    fn bounded<F: FnOnce() + Send + 'static>(limit: Duration, body: F) {
        let (tx, rx) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            body();
            let _ = tx.send(());
        });
        match rx.recv_timeout(limit) {
            Ok(()) => worker.join().expect("the test body panicked"),
            Err(_) => {
                panic!("test body exceeded {limit:?}: likely a drain_and_wait deadlock regression")
            }
        }
    }

    /// The whole point of the dual-stream drain: a child emitting FAR more than one
    /// pipe buffer (~64KB) on BOTH stdout AND stderr concurrently must be drained fully
    /// without wedging. If the two pipes weren't drained on their own threads, whichever
    /// the child filled first would block the child mid-write and `drain_and_wait` would
    /// hang forever. 300KB per stream is well past any platform's pipe buffer.
    #[test]
    fn drain_and_wait_drains_both_full_pipes_without_deadlocking() {
        bounded(Duration::from_secs(20), || {
            let child = Command::new("sh")
                .args([
                    "-c",
                    // Two concurrent writers: 300KB of 'A' to stdout, 300KB of 'B' to
                    // stderr, then `wait` for both. Each far exceeds the pipe buffer.
                    "yes A | head -c 300000 & yes B | head -c 300000 1>&2 & wait",
                ])
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .expect("spawn the dual-stream writer");
            // Generous deadline: a healthy drain finishes in well under a second. Only a
            // regression would approach it — and the `bounded` watchdog fires first.
            let out = drain_and_wait(child, None, Duration::from_secs(60))
                .expect("the wait itself must not fail")
                .expect("the child exits within the deadline");
            assert!(out.status.success(), "the writer exits cleanly");
            assert_eq!(out.stdout.len(), 300_000, "all of stdout was drained");
            assert_eq!(out.stderr.len(), 300_000, "all of stderr was drained");
            // Each stream carries exactly its own bytes — no cross-pipe bleed.
            assert!(
                out.stdout.bytes().all(|b| b == b'A' || b == b'\n'),
                "stdout holds only the stdout stream"
            );
            assert!(
                out.stderr.bytes().all(|b| b == b'B' || b == b'\n'),
                "stderr holds only the stderr stream"
            );
        });
    }

    /// The deadline arm: a child that outlives the deadline comes back `Ok(None)` and is
    /// killed promptly — proven by returning far sooner than the child's own 30s sleep.
    /// (The kill+reap mechanics themselves are pinned in `infra::proc`.)
    #[test]
    fn drain_and_wait_times_out_to_none_on_overrun() {
        let child = Command::new("sh")
            .args(["-c", "sleep 30"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn the sleeper");
        let started = Instant::now();
        let out = drain_and_wait(child, None, Duration::from_millis(200))
            .expect("the wait must not fail");
        assert!(out.is_none(), "an overrunning child times out to Ok(None)");
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "the child is killed at the deadline, not waited out for its full sleep"
        );
    }

    /// `git_with_deadline` maps an overrun to `Err(timeout_msg)`. We point git at a
    /// git:// URL served by a local listener that ACCEPTS but never replies, so git
    /// connects and then blocks reading the protocol response — the exact
    /// black-holed-origin hang the deadline exists for — and assert git is killed at the
    /// deadline with the timeout message, not left to pin the calling thread.
    #[test]
    fn git_with_deadline_surfaces_a_hang_as_the_timeout_error() {
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind a loopback listener");
        let port = listener.local_addr().expect("listener addr").port();
        // Accept one connection and hold it open (never replying) past the deadline, so
        // git is what gets killed — not us closing the socket on it.
        let acceptor = std::thread::spawn(move || {
            if let Ok((stream, _)) = listener.accept() {
                std::thread::sleep(Duration::from_secs(2));
                drop(stream);
            }
        });

        let repo = tempfile::TempDir::new().expect("temp cwd");
        let url = format!("git://127.0.0.1:{port}/repo.git");
        let started = Instant::now();
        let result = git_with_deadline(
            repo.path(),
            &["ls-remote", &url],
            Duration::from_millis(800),
            "git timed out",
        );
        assert_eq!(
            result,
            Err("git timed out".to_string()),
            "a black-holed git op must surface the timeout message, not hang"
        );
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "git is killed at the ~800ms deadline, well before the 2s connection hold"
        );
        let _ = acceptor.join();
    }
}
