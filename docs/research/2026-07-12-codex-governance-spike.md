# Research: Codex governance-enforcement spike (#304) + os.tmpdir() sandbox-read verdict (#310)

**Date:** 2026-07-12
**Agent:** kirei-research
**Status:** complete
**Scope:** Part 1 resolves #310 (Codex sandbox READ scope for `local_image` temp files). Part 2 is the go/no-go spike for #304 (Codex `app-server` approval-RPC enforcement), extending `docs/research/2026-07-12-codex-governance-feasibility.md`'s Open Questions.

Codex CLI installed: `codex-cli 0.144.1` (authenticated via ChatGPT login). All Rust-source
evidence below is pinned to git tag `rust-v0.144.1` in `openai/codex` (exact match to the
installed binary, not `main`). Live spikes were run against the real binary on this
machine (macOS/Darwin, Seatbelt sandbox backend).

## PART 1 — #310 VERDICT: SOUND. Close with evidence, no code change needed.

**Claim being tested:** `codex-images.ts`'s `materializeCodexImages()` writes image bytes to
`os.tmpdir()` and asserts (in a comment) that Codex's sandbox restricts writes/network, not
reads, so an absolute tmpdir path is readable under every posture.

**This is CONFIRMED, on both counts tested (macOS empirical + Linux source-read):**

1. **Empirical (macOS Seatbelt, this machine):** ran real `codex exec` turns (matching
   Nightcore's actual `Thread.runStreamed()` → `codex exec` path) under both
   `--sandbox read-only` and `--sandbox workspace-write`, each asking the model to `cat` a
   file living outside the workspace:
   - `read-only` + `cat /tmp/nightcore-probe-XXXX.txt` → succeeded, `exit_code: 0`,
     `aggregated_output: "secret-probe-value-12345\n"` (exact match to the file's real
     content — not a hallucination, confirmed via the JSONL `command_execution` item, not
     just the model's prose).
   - `read-only` + `touch ./should-fail.txt` (write, same run family) → failed cleanly:
     `"touch: ./should-fail.txt: Operation not permitted"`, `exit code 1` — proves the
     sandbox IS actually enforcing something (this isn't a no-op sandbox), and that it
     denies writes while it allows the read above.
   - `workspace-write` + `cat /tmp/...` → succeeded (same exact-content proof).
   - `workspace-write` + `cat $HOME/nightcore-probe-home.txt` (a location outside BOTH the
     workspace AND tmpdir) → also succeeded — reads are not confined to a tmpdir
     allowlist, they're unrestricted by location under both postures tested.

2. **Source-code (Linux, both backends):**
   - `codex-rs/linux-sandbox/src/landlock.rs:148` (pinned `rust-v0.144.1`) — the (currently
     unused-in-favor-of-bubblewrap, kept-for-reference) Landlock fallback:
     `.add_rules(landlock::path_beneath_rules(&["/"], access_ro))?` — read-only access to
     the entire filesystem root granted unconditionally; writes are the only thing scoped
     to `writable_roots`.
   - The active Linux backend (bubblewrap) is documented (third-party deep-dive,
     cross-referenced) as `--ro-bind /` (read-only-by-default over the WHOLE filesystem,
     not scoped to the workspace) + `--bind` layered only for writable roots — same shape:
     reads are broad, writes are the confined axis.

**Conclusion:** Codex's sandbox model (`read-only` / `workspace-write`, on both the
platforms checked) restricts **writes and network**, not **reads**, and does so with no
tmpdir-specific carve-out — reads are unrestricted by location, full stop. The
`os.tmpdir()` approach in `codex-images.ts` is sound as-is. **No code change is
warranted; recommend closing #310 with this evidence rather than moving temp images to
`${cwd}/.nightcore/tmp/`.**

Caveat (noted for completeness, not a blocker): a newer, separate, non-default permission
system exists in codex-rs (see Part 2 §1) that supports per-path `Deny` on reads too — but
it is NOT what `sandbox_mode: read-only/workspace-write` (the config Nightcore actually
sets) uses. If a future Nightcore change ever switches Codex postures onto that system
(`default_permissions` + `[permissions.*]`), this #310 verdict would need re-checking; it
does not apply to the sandbox model in use today.

## PART 2 — #304 spike results

### §1. Open-Question #3 (the potential Option-B-killer): does a `sandbox_workspace_write.*` path-exclusion/denylist knob exist?

**Answer: NO for the documented/stable knob the question asked about — but a much richer,
completely undocumented, currently-fragile parallel system exists that theoretically could
deliver this. Do not treat it as a near-term Option-B substitute.**

**A. The stable knob (what `options.ts` actually sets) — definitively absent.**
`codex-rs/config/src/types.rs` (pinned `rust-v0.144.1`), the exact struct behind
`[sandbox_workspace_write]`:
```rust
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default, JsonSchema)]
#[schemars(deny_unknown_fields)]
pub struct SandboxWorkspaceWrite {
    pub writable_roots: Vec<AbsolutePathBuf>,   // ADDITIVE only — extends the writable set
    pub network_access: bool,
    pub exclude_tmpdir_env_var: bool,           // toggles whether $TMPDIR counts as writable
    pub exclude_slash_tmp: bool,                // toggles whether /tmp counts as writable
}
```
`#[schemars(deny_unknown_fields)]` makes this exhaustive — there is no sub-path exclusion /
denylist field, only an additive allowlist (`writable_roots`) and two booleans that toggle
two specific default-writable locations. **This is a clean, version-pinned "no" for exactly
the question asked** (a `sandbox_workspace_write.*` path-exclusion option, reachable the
same way `mcp_servers` is passed today via `buildCodexOptions`'s `config` passthrough).

**B. A deeper, separate system DOES exist — `[permissions.<profile>]` — but it's a
different axis, not a `sandbox_workspace_write` addition.**
Digging past the documented config surface (this is NOT in `developers.openai.com`'s public
docs at all) turned up a parallel, richer permission-profile system, confirmed via
`codex-rs/config/src/permissions_toml.rs` and `codex-rs/protocol/src/permissions.rs`
(pinned): a `[permissions.<name>.filesystem]` TOML table mapping arbitrary path keys (or the
sentinel `":workspace_roots"`) to `FileSystemAccessMode::{Read, Write, Deny}` — a genuine
per-path ACL, including `Deny`. Internally the Seatbelt/Landlock policy builders
(`codex-rs/sandboxing/src/seatbelt.rs`'s `build_seatbelt_access_policy` /
`SeatbeltAccessRoot.excluded_subpaths`) already use exactly this shape to hardcode `.git` /
`.codex` protection inside writable roots today. It's wired into `codex exec` itself
(`codex-rs/exec/src/lib.rs` references `default_permissions`), and `codex app-server`
exposes it as `thread/start`'s `permissions?: string` field ("Named profile id for this
thread. **Cannot be combined with `sandbox`**" — confirmed live, see the `thread/start`
response in the spike log: `"sandbox": {...}, "activePermissionProfile": null`).

**Why this does NOT change the recommendation today:**
- It is a **mutually-exclusive alternate axis** to `sandbox_mode`/`approval_policy`
  (`thread/start`'s doc comment says so explicitly), not an additive `-c` passthrough
  alongside the fields `codexPostureForAutonomy()` already sets — adopting it means
  replacing the posture-mapping logic, not extending it.
- **Zero public documentation.** Not mentioned anywhere on `developers.openai.com/codex`
  (checked `config-advanced`, `config-reference`, `concepts/sandboxing`); the only evidence
  is Rust source + Rust integration tests. Higher protocol-instability risk than even the
  approval RPCs, which at least get an upstream "experimental" label and app-server-protocol
  versioning.
- **Empirically fragile in this spike.** A config.toml profile built directly from the
  struct's own field names/types (`default_permissions = "protect-lock"` +
  `[permissions.protect-lock.filesystem]` with `":workspace_roots" = "write"` and one
  absolute-path `= "deny"` entry) produced a **hard `SIGABRT` (exit 134)** on `codex exec`
  for a PLAIN control write (`touch ok2.txt`, no deny rule involved) — not the clean
  `"Operation not permitted"` (EPERM) the legacy `sandbox_mode=read-only` path gives. A
  follow-up attempt adding an explicit `[permissions.protect-lock.workspace_roots]` table
  instead **hung** (killed after a 2-minute timeout with no output). This is either an
  undocumented-required-field gap on our side or genuine immaturity in this feature — either
  way it is not something to build governance enforcement on top of without its own
  dedicated, much longer spike.

**Verdict for §1: the intended `sandbox_workspace_write.*` knob does not exist (confirmed,
version-pinned). The deeper `[permissions.*]` system is a real primitive that could
theoretically deliver protectedPaths at the kernel level someday, but it is undocumented,
structurally incompatible with Nightcore's current posture-mapping approach (exclusive vs.
`sandbox_mode`), and produced crashes/hangs in ad hoc testing. It does NOT obviate Option B
today — it is a separate, even-riskier initiative that would need its own spike (get past
the SIGABRT, confirm SDK/`config` reachability, map trust-level interactions) before being
seriously proposed as an alternative.**

### §2. Live app-server approval-RPC spike — CONFIRMED, with exact wire schema

Spiked via a throwaway Node script (`approval-spike.mjs`, mirrors
`model-catalog.ts`'s spawn/JSON-RPC pattern) driving the real `codex app-server --stdio`:
`initialize` → `thread/start` (`approvalPolicy: "untrusted"`, `sandbox: "workspace-write"`,
in a throwaway git-initialized scratch dir) → `turn/start` with a 3-step instruction: (1) a
read-only `ls -la`, (2) a mutating `touch mutate.txt`, (3) a file edit (`result.txt`).

**(i) Approval requests ARE received — confirmed, but under NEW method names, not the
legacy pair.** On this installed 0.144.1 binary, with `capabilities: null` (the same minimal
client-declaration `model-catalog.ts` already uses), the server sent:
- `item/commandExecution/requestApproval` for the `touch mutate.txt` step
- `item/fileChange/requestApproval` for the `result.txt` edit

**neither `execCommandApproval` nor `applyPatchApproval` (the legacy pair the feasibility
doc's secondary sources described) fired at all.** This directly resolves that doc's Open
Question — the newer `item/*/requestApproval` flow has effectively superseded the legacy
pair for a default-capabilities client on this version. (The legacy methods still exist in
the generated TS bindings — `codex app-server generate-ts` still emits
`ExecCommandApprovalParams`/`ApplyPatchApprovalParams` — so they may still be reachable
under some other capability negotiation, but they are not what actually fires.) **This
naming churn between doc-research-time and this spike, on the SAME general CLI generation,
is itself evidence for the "experimental, may evolve" risk called out in the original
research.**

**Actual wire schema observed (verbatim from the live run):**
```jsonc
// server -> client REQUEST
{
  "method": "item/commandExecution/requestApproval",
  "id": 0,
  "params": {
    "threadId": "...", "turnId": "...", "itemId": "call_...",
    "startedAtMs": 1783886024554,
    "environmentId": "local",
    "command": "/bin/zsh -lc 'touch mutate.txt'",
    "cwd": "/absolute/path",
    "commandActions": [{ "type": "unknown", "command": "touch mutate.txt" }],
    "proposedExecpolicyAmendment": ["touch", "mutate.txt"],
    "availableDecisions": ["accept", { "acceptWithExecpolicyAmendment": {...} }, "cancel"]
  }
}
// client -> server RESPONSE
{ "id": 0, "result": { "decision": "decline" } }
```
```jsonc
{
  "method": "item/fileChange/requestApproval",
  "id": 1,
  "params": { "threadId": "...", "turnId": "...", "itemId": "call_...", "startedAtMs": ..., "reason": null, "grantRoot": null }
}
```
Decision vocabularies **differ per request type and are NOT the legacy `"approved"/"denied"`
strings**: `CommandExecutionApprovalDecision = "accept" | "acceptForSession" | {...amendment...} | "decline" | "cancel"`;
`FileChangeApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel"`. (Legacy
`ReviewDecision`, still present in the schema, uses `"approved"/"denied"/"approved_for_session"/...`
instead — a second reason an Option-B client would need version-aware decision-string handling.)

**(ii) Denial GENUINELY blocks the action — confirmed at the filesystem level, not just the
event stream.** After replying `{"decision":"decline"}` to both requests:
- stderr: `error=exec_command failed ... CreateProcess { message: "Rejected(\"rejected by user\")" }`
  and `error=patch rejected by user`
- the agent's own final turn message: *"2. `touch mutate.txt`: denied ... 3. Create/edit
  `result.txt`: denied ..."*
- **decisive proof:** `ls -la` on the real scratch workspace after the turn showed neither
  `mutate.txt` nor `result.txt` on disk — the OS-visible side effects never happened.
- **Control run** (identical script, same 3-step turn, replying `{"decision":"accept"}`
  instead): both files DID appear (`mutate.txt` empty, `result.txt` containing
  `hello-from-spike`, `exitCode: 0`, `status: "completed"`) — proving causality: this is a
  real, bidirectionally-controllable gate, not a coincidental no-op or a soft warning path.

**(iii) Trusted-command bypass — confirmed, directly against the installed binary.** The
read-only `ls -la` step in the SAME turn, under the SAME `approvalPolicy: "untrusted"`, ran
immediately with **no approval request at all** (`item/started` → `item/completed`,
`status: "completed"`, straight to the aggregated output) — validating the doc's claim
that `untrusted` auto-runs commands the CLI's own classifier judges safe, with zero seam for
Nightcore's client to intercept or audit that decision.

**Bonus finding (context for Option B risk, not a blocker):** `thread/start`'s response
included `"approvalsReviewer": "user"` — a field (`ApprovalsReviewer = "user" |
"auto_review" | "guardian_subagent"`) that routes approval requests to a *different*
target entirely if not explicitly pinned to `"user"`: `"auto_review"`/`"guardian_subagent"`
hand the accept/deny decision to Codex's own internal AI reviewer instead of the app-server
client. Any Option B implementation MUST explicitly set `approvalsReviewer: "user"` on
`thread/start`/`turn/start` or its approval requests may silently stop reaching Nightcore's
process at all.

### §3. Open-Question #2 (npm SDK approval callback) — still absent, checked against the latest release

`@openai/codex-sdk` pinned in `packages/engine/package.json` is `0.142.5`. Checked the
package's own `.d.ts` (no callback) and separately pulled the **latest published npm
release, `0.144.1`** (same release train as the installed CLI) via `npm pack` — its
`dist/index.d.ts` is **identical on this axis**: `ApprovalMode = "never" | "on-request" |
"on-failure" | "untrusted"` still only feeds a static `--config approval_policy=...` CLI
flag; `TurnOptions` still has no request/response surface. **No SDK-side movement toward
exposing the app-server approval channel as of the current latest release** — the "abandon
the versioned SDK" cost the original doc flagged for Option B is unchanged. Not pursued
further per the task's "lightly" instruction; an upstream feature request against
`openai/codex` remains the only lever here.

## GO / NO-GO / CONFIG-KNOB-INSTEAD recommendation for #304 Option B

**Recommendation: GO, but as a fully-scoped separate initiative — NOT a quick add.**
Config-knob-instead is **NOT** available today (§1); the intended knob doesn't exist, and
the deeper alternative is too undocumented/fragile to substitute for it right now.

The core enforcement mechanism is now proven, not theoretical:
- The approval seam exists, fires reliably, and is client-controllable (§2i).
- Deny is a real, hard, pre-execution block with zero observable side effects (§2ii) — not
  a soft warning, which was the biggest open risk in the original research.
- The trusted-command bypass is real and narrows coverage exactly as documented (§2iii) —
  known, bounded gap, not a surprise.
- The exact wire schema is now captured firsthand (§2), replacing the doc's
  secondary-source guess and revealing it was already stale (method names moved from the
  legacy pair to `item/*/requestApproval` between when that research was written and this
  spike, on the same CLI generation) — **concrete, first-party evidence for the protocol-
  instability risk**, not a hypothetical one.

**Effort/risk sizing (rough):**
- **Effort:** Large — matches the original doc's Option B file list
  (`sdk-adapter.ts`-equivalent event translation for the `item/*`/`turn/*` vocabulary,
  `CodexSession` rewritten around `thread/start`/`turn/start`/`turn/interrupt` instead of
  `Thread.runStreamed()`/`AbortController`, a new hook-bus-equivalent mapping
  `item/commandExecution/requestApproval` → synthetic `Bash` calls and
  `item/fileChange/requestApproval` → synthetic `Write` calls into the existing
  provider-neutral `evaluateHarnessPolicy`/`evaluateToolDeny`/`SessionLedger` functions).
  Nothing in this spike shrinks that scope; if anything the confirmed method-name churn
  since the original doc argues for MORE defensive version-handling than originally
  planned (e.g. runtime-detect which approval method names/decision vocabularies the
  connected binary actually uses, rather than hardcoding one pair).
- **Risk:** Medium-high, unchanged from the original doc's assessment, now with firsthand
  confirmation rather than secondary-source inference: (a) protocol churn — this spike
  itself is proof the wire surface moves between releases; (b) coverage ceiling — trusted-
  bypass and zero MCP-tool-call approval events mean Option B can never reach Claude's
  `PreToolUse` parity, must be spec'd as "narrower, not equivalent"; (c) must explicitly
  pin `approvalsReviewer: "user"` or the whole mechanism silently routes around Nightcore's
  client.
- **Sizing verdict:** worth building (the seam is real and works exactly as needed), but
  it is its own multi-PR initiative on the scale of a Codex turn-driver rewrite — do not
  fold it into a "quick fix" for #296 or #304 as currently scoped; the maintainer's own
  "separately-evaluated follow-up" framing in the original doc was correct and this spike
  validates going ahead with that framing, not accelerating past it.

## Files to Modify (only if #304/Option B is separately greenlit — NOT this task)

Unchanged from `docs/research/2026-07-12-codex-governance-feasibility.md`'s "Files to
Modify (if Option B is later greenlit)" section — this spike does not add or remove files
from that list, it only de-risks the plan with confirmed evidence. One addition based on
this spike's findings:
- `packages/engine/src/providers/codex/options.ts` (or the new app-server adapter) must
  explicitly set `approvalsReviewer: "user"` on `thread/start`/`turn/start` (§2 bonus
  finding) — omitting it is a silent-bypass trap, not a cosmetic default.

## Reference Files (do not modify)

- `packages/engine/src/providers/codex/codex-images.ts` — the #310 subject; sound as-is,
  no change needed (see Part 1 verdict).
- `packages/engine/src/providers/codex/model-catalog.ts:149-243` — the connection pattern
  the live spike script mirrors; still the best template for a real app-server client.
- `packages/engine/src/providers/codex/options.ts` (`codexPostureForAutonomy`) — the
  "DEADLOCK INVARIANT" docblock remains accurate for the CURRENT `@openai/codex-sdk`-driven
  path; this spike's findings apply only to a hypothetical future `app-server`-driven path,
  not to any change needed here today.
- `docs/research/2026-07-12-codex-governance-feasibility.md` — the doc this spike resolves
  Open Questions #2 and #3 against, and re-confirms/refines Open Question #1 (the "How to
  Verify" spike) for.

## Risks & Gotchas

- **Method-name/decision-vocabulary churn is now empirically demonstrated, not just
  upstream-labeled.** Any Option B build needs runtime capability detection or defensive
  handling for both the legacy (`execCommandApproval`/`applyPatchApproval`,
  `decision: "approved"|"denied"`) and current (`item/*/requestApproval`,
  `decision: "accept"|"decline"`) shapes, since which one fires may depend on client
  capability negotiation this spike did not exhaustively map (only tested `capabilities:
  null`).
- **`approvalsReviewer` silent-bypass trap** — see §2 bonus finding and Files to Modify.
- **The `[permissions.*]` system (§1B) is real but unsafe to touch right now** — it crashed
  (`SIGABRT`) and hung in ad hoc testing here. Do not let its existence tempt a "quick"
  protectedPaths win; it needs its own dedicated spike (get a working minimal repro,
  understand trust-level interactions, confirm `-c`/`config` reachability from
  `@openai/codex-sdk`) before it's a real option, and even then it's an alternate axis to
  `sandbox_mode`, not an addition.
- **This spike used `capabilities: null` and a fresh, throwaway, git-initialized scratch
  directory with an untrusted (non-listed-in-`~/.codex/config.toml`) project.** Codex's
  project trust-level system (`trust_level = "trusted"` entries seen in the real
  `~/.codex/config.toml`) was not exercised here; a real Nightcore-driven repo is normally
  a trusted project on the user's machine, which could plausibly change which commands the
  "trusted command" classifier auto-runs without a request (worth re-checking if Option B
  is greenlit, using a trusted project rather than a throwaway scratch dir).
- **Live spike consumed real Codex API usage** (a handful of small `gpt-5.5` turns) —
  kept intentionally minimal per the task's "cheap" instruction, but this is not a free,
  repeatable-forever check; future re-verification against newer Codex CLI releases should
  stay similarly minimal.

## How to Verify

- **#310:** re-run `codex exec --sandbox read-only -c approval_policy=\"never\"
  --skip-git-repo-check -C <scratch-dir> --json "cat <absolute-tmpdir-path>"` against any
  installed Codex CLI version and confirm the file content comes back in
  `command_execution.aggregated_output` with `exit_code: 0`.
- **#304 §2:** re-run the throwaway `approval-spike.mjs` pattern (spawn
  `codex app-server --stdio`, `initialize`, `thread/start` with `approvalPolicy:
  "untrusted"`, `turn/start` with a mutating command + file edit) against a newer Codex CLI
  release before greenlighting Option B, to catch any further method-name/schema drift
  before committing to a build.

## Open Questions

- Whether the legacy `execCommandApproval`/`applyPatchApproval` pair still fires under some
  OTHER client capability declaration (this spike only tried `capabilities: null`) — not
  load-bearing for the GO decision (either shape is a real, working seam), but relevant to
  exactly how defensive an Option B adapter needs to be.
- Whether Codex project trust-level (`trusted` vs. untrusted project) changes which
  commands the `untrusted`-policy classifier auto-runs without a request — not tested here
  (scratch dir was untrusted-by-omission); worth checking against a trusted project before
  finalizing Option B's coverage claims.
- Full characterization of the `[permissions.*]` system's SIGABRT/hang failure modes was
  explicitly NOT pursued past the point of establishing it's unsafe to rely on today (time-
  boxed per the task's priority ordering) — if `default_permissions` is ever revisited, it
  needs its own dedicated spike, not a continuation of this one's ad hoc probing.
