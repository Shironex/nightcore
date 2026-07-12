# Platform-primitives adoption spike (T12 / #153) — decision memo

**Scope:** decide whether Nightcore should adopt the Claude Code / Agent SDK
**native sandbox primitives** in place of its custom Seatbelt writer, and produce a
migration plan + the two user-facing decisions (D3, D4). Feeds the execution ticket
**T16 / #157** (native-sandbox adoption) and the review-calibration build **#197**
(structured outputs). Read alongside the roadmap `2026-07-11-roadmap-v0.3-v0.5.md`
§2.3, §5.4, §6, §8.

Grounding is by `file:line` and by primary-source doc citation. The pinned SDK is
`@anthropic-ai/claude-agent-sdk@0.3.190` (`packages/engine/package.json:15`); latest
published is `0.3.207`. The authoritative sandbox behavior is the shipped SDK
`sandbox` schema (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2639-2692`)
cross-checked against the current docs (`code.claude.com/docs/en/sandboxing`,
fetched 2026-07-12).

---

## §1 Executive recommendation — **HYBRID (adopt native sandbox for the OS layer; KEEP the PreToolUse gate)**

Adopt the SDK's native `Options.sandbox` to **replace the custom Seatbelt writer**
(`packages/engine/src/providers/claude/sandbox.ts`, 373 lines + `sandbox.test.ts`
464 lines + the premium-billed macOS CI lane at `.github/workflows/ci.yml:40-60`),
and **keep every PreToolUse policy gate** (`packages/engine/src/policy/**`) exactly
as-is. This is not "adopt vs keep" — the two layers cover **disjoint** tool surfaces
and must both exist. Five load-bearing reasons:

1. **The native sandbox and the custom Seatbelt writer do the *same job* (deny-write-
   except-cwd for shell subprocesses) — one is maintained by Anthropic, the other by
   us.** Nightcore's writer hand-rolls: TinyScheme profile generation
   (`sandbox.ts:104-127`), a wrapper-script exec shim (`:141-155`), an availability
   probe (`:180-197`), worktree `.git`-common-dir derivation (`:221-247`), and the
   `~/.claude` config-poisoning carve-out (`:286-303`). The native sandbox does **all
   of these for free**, including the worktree case ("the sandbox also allows writes
   to the main repository's shared `.git` directory … Writes to `hooks/` and `config`
   inside that directory remain denied" — docs, Filesystem isolation) and the config
   self-protection ("the sandbox automatically denies write access to Claude Code's
   `settings.json` files at every scope" — docs, Security limitations).

2. **It closes the Linux/WSL gap (security F2) for free.** Nightcore's writer is
   macOS-only — `probeSandbox()` returns `false` on any non-darwin host
   (`sandbox.ts:181`), so **Linux and Windows task runs have zero OS containment
   today**. The native sandbox runs on macOS (Seatbelt), Linux (bubblewrap), and WSL2
   (bubblewrap); the `SandboxSettings` schema even carries `bwrapPath`/`socatPath`
   (`sdk.d.ts:2690-2691`). Native Windows is still unsupported (must use WSL2) — that
   residual moves to the "Windows containment" v0.5 item, unchanged.

3. **But the native sandbox is Bash-only, so it cannot replace the PreToolUse gate.**
   Primary source, verbatim: *"The sandbox isolates Bash subprocesses. Other tools
   operate under different boundaries: Built-in file tools: Read, Edit, and Write use
   the permission system directly rather than running through the sandbox"* (docs,
   Scope). Nightcore's real worktree-escape incident (2026-07-01) was a `Write`/`Edit`
   to the parent repo — a **native tool call**, which the OS sandbox never sees. The
   PreToolUse gate is the *only* thing that confines `Write`/`Edit`/`MultiEdit`/
   `NotebookEdit`/`ApplyPatch` and `mcp__*` writes (`workspace-confinement.ts:154-295`),
   escalates exec-sink writes (`exec-sink.ts`), hard-denies `.git/config` poisoning
   (`confinement/git-config.ts`), and blocks credential-store reads
   (`confinement/sensitive-read.ts`). None of that is in scope for the command sandbox.
   Deleting it would re-open every hole it closes.

4. **`sandbox.credentials` adds a capability we have never had — "secrets never enter
   the agent" — but the marketed `mask` mode is a version-gated hazard, not free.**
   At the **pinned 0.3.190**, `SandboxCredentialsConfig` is `mode: 'deny'`-**only**
   for both files and env vars, and the SDK's own schema comment says mask "sandbox-
   runtime can't enforce yet; widen the mode (e.g. `mask`) only once a sandbox-runtime
   version that enforces it ships" (`sdk.d.ts:2585-2600`). `mask` + `injectHosts`
   **does** exist in the current CLI docs but requires Claude Code **v2.1.199+** *and*
   `network.tlsTerminate` *and* a newer SDK than we pin. So: adopt `deny` now (unset
   `GITHUB_TOKEN`/AWS/`ANTHROPIC_*` from sandboxed Bash, block `~/.aws`/`~/.ssh`
   reads), and treat `mask` as a **later, re-verified** follow-up — the roadmap §2.3
   "credential mask" claim is real but **not shippable at our pinned version**.

5. **The migration surface is tiny and the deletion is large.** The entire wiring is
   one `if (this.cfg.sandboxWrites === true)` block that swaps
   `pathToClaudeCodeExecutable` for a wrapper (`session-runner.ts:275-288`). Replacing
   it with `options.sandbox = {…}` deletes ~840 lines of security-critical custom code
   + a premium macOS CI lane, and hands the containment guarantee to a layer Anthropic
   fuzzes and ships weekly. That is exactly the roadmap's "adopt-don't-maintain" thesis.

**Net:** delete the Seatbelt writer, wire `Options.sandbox`, keep the PreToolUse gate
as the permanent tool-input layer. The two are complementary (docs, "How sandboxing
relates to permissions": *"complementary layers"*).

---

## §2 Current containment map (what / where / OS / residual gaps)

Nightcore has **two** independent containment layers today. Only the first is a
candidate for replacement.

### 2.1 OS layer — opt-in macOS Seatbelt WRITE sandbox (the replacement candidate)

| Aspect | Detail | Evidence |
|---|---|---|
| What | Wraps the resolved `claude` binary in `/usr/bin/sandbox-exec` with a `(allow default)` + `(deny file-write*)` + allow-roots profile — **write containment only**, reads + network stay open | `sandbox.ts:1-59`, `buildSeatbeltProfile` `:104-127` |
| Writable roots | session cwd; worktree `.git` common dir; `/dev`; temp trees; `~/.claude` state; `~/Library/Caches/claude-cli-nodejs` | `deriveWritableRoots` `:256-281` |
| Config carve-out | denies `~/.claude/settings.json`, `settings.local.json`, and the `~/.claude.json*` family even inside the writable root (hook-injection RCE) | `:283-303`, `:345-353` |
| Wiring | Rust global `sandbox_sessions` → `guardrails.sandbox_writes` → engine `sandboxWrites` → swap `pathToClaudeCodeExecutable` to the wrapper | `store/settings/model.rs:122`, `sidecar/commands.rs:107-110`, `session-runner.ts:275-288` |
| OS coverage | **macOS only** — `probeSandbox()` returns false on non-darwin | `sandbox.ts:181` |
| Default | **opt-in / default-off** (`sandbox_sessions: false`) | `store/settings/model.rs:523` |
| Failure posture | **fail-OPEN**: unavailable/failed → warn loudly, run unwrapped | `prepareWriteSandbox` `:328-337`, `:363-371` |
| CI proof | dedicated premium macOS lane runs the enforcement tests | `.github/workflows/ci.yml:40-60` |
| **Residual gaps (self-documented)** | (a) **no Linux/Windows coverage at all**; (b) the wrapper/profile live in a writable temp tree → a concurrent session could tamper a *not-yet-exec'd* sibling wrapper (`:54-58`); (c) reads + network fully open by design; (d) user hooks that write outside the roots break (observed: GitKraken SessionEnd) (`:49-52`) | module header `sandbox.ts:1-59` |

### 2.2 Tool-input layer — the bypass-proof PreToolUse gate (KEEP — not replaceable)

Runs inside the SDK `PreToolUse` hook, which fires **regardless of `permissionMode`**
including `bypassPermissions` (Nightcore's default), so it holds under the unattended
studio config. Orchestrated in `hook-bus.ts:139-198`, four tiers in order:

1. **Destructive-command deny** (`rm -rf`, force-push, network-exfil) — `tool-deny-policy.ts`.
2. **Workspace confinement** — file mutations outside run cwd are DENIED (native tools
   exact; Bash lexical/best-effort; `ApplyPatch` multi-target; MCP name-heuristic
   fallback); plus `.git/config` hard-deny (`confinement/git-config.ts`) and sensitive-
   read denylist (`confinement/sensitive-read.ts`). Facade + full gap list:
   `workspace-confinement.ts:1-89`, dispatch `:154-295`.
3. **Harness runtime policy** — per-project `protectedPaths` + Bash deny + tool
   deny/ask tiers (incl. `mcp__server__*` prefix tiers) from `.nightcore/harness.json`
   (`harness-policy.ts:163-234`).
4. **Exec-sink ASK** — writes to `.github/workflows/**`, `.claude/**`, `.git/hooks/**`,
   `.husky/**`, `package.json`, `.envrc`, `.mise.toml` are escalated to an interactive
   approval that holds under bypass (`exec-sink.ts:88-104`, `:207-236`).

**Residual gaps (self-documented, all "real containment is the OS sandbox"):** Bash
write vectors that can't be resolved lexically (`> $VAR/x`, `> $(…)`, `python -c
"open(...,'w')"`), symlink-in-two-steps (`ln -s /repo esc; Write esc/…`), and
unconventionally-named MCP writers (`workspace-confinement.ts:33-60`). **These are
precisely the gaps the native sandbox's OS-level enforcement closes** — the two layers
are designed to backstop each other.

---

## §3 Native sandbox capabilities (what the SDK offers NOW) + the gap-closure

`Options.sandbox?: SandboxSettings` is a **first-class typed option already present in
the pinned 0.3.190** (`sdk.d.ts:1770`, doc block `:1730-1768`). Full schema at
`sdk.d.ts:2639-2692`. Nightcore passes **nothing** sandbox-related to the SDK today —
it wraps the executable instead.

**Enable / degradation controls**
- `sandbox.enabled: boolean` — turn it on (`sdk.d.ts:2645`).
- `sandbox.failIfUnavailable: boolean` — **defaults `true` when `enabled:true`** via
  the Options path: if deps are missing (e.g. bubblewrap on Linux) or the platform is
  unsupported, `query()` **emits an error result and exits** rather than running
  unsandboxed (`sdk.d.ts:1743-1747`). Set `false` for graceful degradation. Note the
  polarity flip: Nightcore's custom path is fail-**open**; the native default is
  fail-**closed**. This is a D3-relevant knob.
- `sandbox.autoAllowBashIfSandboxed: boolean` — auto-approve sandboxed Bash without
  prompting (`sdk.d.ts:2647`); explicit deny/ask rules and `rm` of critical paths still
  prompt (docs, Sandbox modes).
- `sandbox.allowUnsandboxedCommands: boolean` — controls the model's
  `dangerouslyDisableSandbox` escape hatch (`sdk.d.ts:2648`; `sdk-tools.d.ts:477-479`).
  **Set `false` (strict) for Nightcore**: under our `bypassPermissions` default, an
  unsandboxed retry would auto-allow, silently defeating the boundary.

**Filesystem** (`SandboxFilesystemConfig`, `sdk.d.ts:2664-2670`): `allowWrite[]`,
`denyWrite[]`, `denyRead[]`, `allowRead[]`, `allowManagedReadPathsOnly`. Default =
write cwd + session `$TMPDIR`, read whole machine except denied (docs). This is a
**direct, declarative replacement** for `deriveWritableRoots` + `buildSeatbeltProfile`.

**Network** (`SandboxNetworkConfig`, `sdk.d.ts:2649-2663`): `allowedDomains[]`,
`deniedDomains[]`, `allowManagedDomainsOnly`, `allowUnixSockets[]`, `allowLocalBinding`,
`httpProxyPort`, `socksProxyPort`, `tlsTerminate{caCertPath,caKeyPath}`. A real egress
proxy — **beyond** Nightcore's current lexical Bash `network-exfiltration` deny rule.
Off by default (no domains pre-allowed); adopting network restriction is optional and
separable from write containment.

**Credentials** (`SandboxCredentialsConfig`, `sdk.d.ts:2671-2680`): `files:[{path,
mode:'deny'}]`, `envVars:[{name, mode:'deny'}]`.
- **Pinned 0.3.190 = `deny` only.** The schema literal is `z.ZodLiteral<"deny">` for
  both arrays, and the doc comment states mask is not yet enforceable (`:2585-2600`).
- **Current CLI docs** add `envVars … mode:'mask'` + `injectHosts[]` (files stay
  deny-only), requiring **Claude Code v2.1.199+**, `network.tlsTerminate`, and honoring
  it only from user/managed/CLI settings (never repo `.claude/settings.json`). Masking
  keeps `gh`/`npm` working while the agent only ever sees a per-session sentinel.
- **Verdict:** adopt `deny` now (a strict improvement — today Nightcore hands the
  agent's env to sandboxed shells uncontained); defer `mask` to a version-bump
  follow-up and **re-verify the SDK schema still gates it** before wiring.

**Other knobs:** `ignoreViolations`, `enableWeakerNestedSandbox` (Docker-in-Docker),
`enableWeakerNetworkIsolation` (MITM CA), `allowAppleEvents` (removes isolation —
leave OFF), `excludedCommands[]` (tools incompatible with the sandbox, e.g. `docker`,
`gh`/`gcloud` on macOS Go-TLS), `ripgrep` (`sdk.d.ts:2681-2691`).

**Embedding-app lockdown:** `Options.managedSettings` (`sdk.d.ts:1789-1812`) is the
"desktop app derives lockdown from its own config and enforces it on the spawned
subprocess, restrictive-only" path — Nightcore is the textbook case. The `sandbox`
block can be delivered here so a repo's `.claude/settings.json` cannot widen it.

**Gap-closure bought:** Linux/WSL containment (F2) for free; OS-enforced closure of the
PreToolUse layer's documented Bash-write residuals (redirects/symlinks/dynamic targets)
— *for Bash only*; env-credential stripping from sandboxed shells (new capability);
deletion of ~840 lines of custom security code + a premium CI lane; and worktree
`.git`/config-poison handling maintained upstream. **Not bought** (still the PreToolUse
gate's job): confinement of `Write`/`Edit`/`ApplyPatch`/`NotebookEdit`/`mcp__*`, exec-
sink ASK, `.git/config` deny, sensitive-read deny.

---

## §4 Structured-output migration recipe (proven on ONE scan family: **pr-review**)

**Why pr-review:** the roadmap ties structured outputs to the review-calibration build
(#197 / v0.4 §6), and pr-review has three parseable passes (lens findings, adversarial
validator, merge verdict) — the verdict being a single object is the cleanest possible
fit. Insight is the fallback candidate if pr-review is deferred.

**The template already exists** — `decompose` proved it (roadmap §9 item 8). It launches
with `Options.outputFormat = { type:'json_schema', schema:{…} }`
(`decompose.ts:41-65`), the SDK forces schema-conforming output and internally retries,
the result message carries `structured_output`, and the adapter prefers it over text
parse with a text fallback (`sdk-adapter.ts:465-506`; `subtasksFromStructuredOutput`
vs `parseSubtasks` in `decompose.ts:92-110`). The `error_max_structured_output_retries`
subtype maps to a distinct failure (`sdk-adapter.ts:506`), so a non-conforming run fails
**visibly** instead of emitting prose.

**Today, scans are prompt-and-parse (the fragile class):** `prReviewOutputContract()`
appends a *prose* "Output ONLY a JSON array" instruction (`pr-review/presets.ts:138-155`;
Insight's twin at `insight/presets.ts:108-128`), and the engine text-parses the result
string via `parsePrReviewFindings` (`pr-review/manager.ts:145-149`). `SessionConfigParts`
has **no `outputFormat` field** (`scans/shared/scan-manager.ts:156-162`), so scans can't
request structured output at all yet.

**Concrete steps (all mechanical, mirror decompose):**

1. **Define the schema.** Add `PR_REVIEW_OUTPUT_FORMAT` in `pr-review/findings.ts`
   (or `presets.ts`), object-wrapped `{ type:'object', properties:{ findings:{ type:
   'array', items:{…severity enum, file, line?, title, body, suggestedFix? } } },
   required:['findings'], additionalProperties:false }` — structured output requires
   `additionalProperties:false` at **every** object level (`decompose.ts:37-38`). Mirror
   the fields the model currently supplies in `prReviewOutputContract`; keep engine-
   assigned fields (`lens`, `id`, `fingerprint`) OUT of the schema (they're already
   engine-assigned, `presets.ts:136`).
2. **Plumb one field.** Add `outputFormat?: OutputFormat` to `SessionConfigParts`
   (`scan-manager.ts:156`) and thread it into the built `SessionRunnerConfig` with a
   `...(parts.outputFormat ? { outputFormat: parts.outputFormat } : {})` spread —
   right beside the existing `maxBudgetUsd` spread (`scan-manager.ts:459-462`). One line.
3. **Return it from the preset.** In `PrReviewManager.sessionConfig()` add
   `outputFormat: PR_REVIEW_OUTPUT_FORMAT` (`pr-review/manager.ts:119-127`).
4. **Surface `structured_output` on the scan completion path.** The scan
   `session-completed` event currently carries only `result: string`
   (`scan-manager.ts:465-468`). Generalize the runner completion event to also carry
   `structuredOutput` (the adapter already extracts it for decompose — lift that so
   every kind gets it), then have `parse()` prefer it: `structuredFindings(structured)
   ?? parsePrReviewFindings(result, lens)`. The text parser stays as the fallback for
   older/degraded runs — identical to decompose's dual path.
5. **Fail visible.** Map `error_max_structured_output_retries` (already a distinct
   `session-failed` reason) to a **degraded-lens** chip rather than an empty result —
   this is exactly the roadmap §5.2 "fail-visible reviews" requirement, and structured
   output makes the failure detectable.
6. **Repeat for the validator + verdict passes.** Verdict is a single object
   (`{ verdict:'can_merge'|'needs_revision'|…, rationale }`) — the highest-value, lowest-
   risk conversion; it removes the "reviewer isn't trusted at current noise" parse-drift
   the roadmap §6 review-calibration item calls out.

**Outcome for #197:** enforced per-lens output shape means the severity rubric,
verdict floor/ceiling, and dedupe logic operate on schema-valid data instead of
best-effort-parsed prose — the precondition for calibrating reviewer trust.

---

## §5 Runtime MCP management (exists vs. gap)

**Exists (roadmap §9 item 1 confirmed):**
- **CRUD UI:** `apps/web/src/components/settings/McpServersCard/**` (card, editor,
  hooks, stories) + `SettingsView.hooks.ts`.
- **Rust store + wire:** `store/settings/{model,patch,store}.rs`,
  `provider/{types,imp}.rs`, `sidecar/provider_config.rs`, generated contracts.
- **Per-session injection into the SDK:** `toSdkMcpServers()` folds enabled entries
  into `Options.mcpServers`, additively over the user's native config
  (`session-options.ts:51-79`, `:353` / `:393-395`), shared by run + inspector probe.
- **Coarse governance already shipped:** harness-policy supports `mcp__server__*`
  prefix **deny/ask tiers** (`harness-policy.ts:163-234`, tests #223), and the bypass-
  mode MCP-containment fallback classifies + confines/denies write/network MCP tools,
  fail-closed on unknown (`confinement/mcp.ts:276-332`).

**Gap (what "runtime MCP management" would still add):**
- **Per-server default governance tier in the UI.** Today an allow/ask/deny tier for a
  server requires hand-authoring a `.nightcore/harness.json` `mcp__<server>__*` prefix
  rule; there is no per-server tier selector in `McpServersCard`. (This is roadmap
  §9-1's "MCP *governance* … per-server default tier, wildcards, scoping".)
- **Lifecycle/health surfacing.** No runtime start/stop/restart or reachability status
  per server; the SDK's `command_lifecycle` / `background_tasks_changed` frames
  (roadmap §2.3 item 4) are not consumed.
- **Interactive MCP auth.** OAuth/remote-transport auth handshakes aren't surfaced.

**Assessment:** MCP management is **orthogonal to the sandbox adopt/keep decision** and
should not gate T16. The governance-tier UI is a small, high-value follow-up (fits the
v0.4 Policy-UX item); lifecycle frames are a watch-item. Nothing here blocks §6.

---

## §6 Migration plan (execution ticket T16 / #157) — ordered, with risk notes

**Invariant (do not revisit): KEEP the PreToolUse gate.** The native sandbox is
Bash-only; the gate is the sole layer over `Write`/`Edit`/`ApplyPatch`/`NotebookEdit`/
`mcp__*` and the only place exec-sink/`.git/config`/sensitive-read live. Adopting the
sandbox changes the *OS layer* only.

1. **Preflight capability probe.** Add a provider capability that reports whether the
   installed `claude` CLI + platform support the native sandbox (probe `/sandbox` deps:
   Seatbelt on macOS; bubblewrap+socat on Linux/WSL2). Cache like `sandboxAvailable()`.
   *Risk:* the user's installed `claude` is a REQUIRED prereq (decided 2026-06-23) and
   its version varies; `mask` needs v2.1.199+ — gate features on the probed version, not
   on the SDK version alone.
2. **Wire `Options.sandbox` in the session path only.** In `session-options.ts run()`,
   emit `sandbox: { enabled: true, failIfUnavailable: <D3>, allowUnsandboxedCommands:
   false, filesystem: { allowWrite: [<cwd + worktree .git common dir + temp>] },
   credentials: { envVars: [deny GITHUB_TOKEN/AWS_*/ANTHROPIC_*…], files: [deny ~/.aws,
   ~/.ssh, ~/.gnupg…] } }` when the guardrail is on. Keep `pathToClaudeCodeExecutable =
   claudePath` (still needed for the compiled `$bunfs` resolution) but **stop swapping
   it for a wrapper**. Scans need nothing (read-only, no execution surface).
3. **Delete the custom writer.** Remove `sandbox.ts`, `sandbox.test.ts`, the
   `session-runner.ts:275-288` wrapper block, and simplify the macOS CI lane
   (`ci.yml:40-60`) to a native-sandbox smoke test (or drop it — the guarantee is now
   upstream's).
4. **Reconcile the Rust seam.** `sandbox_sessions` → engine flag stays the wire; the
   engine now emits `Options.sandbox` instead of a wrapper. Serde-additive; no contract
   break. *Risk:* keep the loud-unavailability warning (see D3) — with `failIfUnavailable`
   the run now *errors* rather than silently degrading, so the UI must explain why.
5. **Adopt `credentials.deny` immediately; park `mask`.** Ship env/file deny now. File a
   follow-up for `mask`+`injectHosts` gated on: SDK schema widening past `deny`
   (`sdk.d.ts:2585-2600` re-check), CLI ≥ v2.1.199, and `network.tlsTerminate` wiring.
6. **Optional, separable: network egress.** `allowedDomains`/proxy is a *later* toggle;
   don't couple it to write containment in the first cut (default = prompt-on-new-domain
   would fight the unattended flow). Revisit with the budget/usage work.
7. **Dogfood assertion.** Extend the workspace-confinement dogfood check to assert both
   layers fire under `bypassPermissions`: a Bash redirect to `$HOME` is OS-denied AND a
   `Write` to the parent repo is gate-denied.

**Cross-cutting risks:** (a) `failIfUnavailable` polarity flip (fail-open→fail-closed)
is a behavior change users will notice on unsupported hosts — needs the D3 opt-out +
loud surface. (b) macOS Go-TLS tools (`gh`, `gcloud`) and `docker` need `excludedCommands`
or they break under Seatbelt (docs, Troubleshooting) — pre-seed the exclusion list. (c)
`--dangerously-skip-permissions`/`allowDangerouslySkipPermissions` as root is blocked
unless inside a recognized sandbox — should *improve* under native sandbox, but verify on
Linux CI. (d) SDK release cadence becomes a dependency — mitigated because the PreToolUse
gate remains the independent backstop if a sandbox regression ships.

---

## §7 Decisions for the user

### D4 — Native-sandbox adoption (adopt vs keep)

> **Question:** Should Nightcore delete its custom macOS Seatbelt writer and adopt the
> SDK's native `Options.sandbox` (gaining Linux/WSL containment + env-credential
> stripping, and offloading maintenance to Anthropic), while keeping the PreToolUse
> policy gate unchanged — accepting that OS write-containment now depends on Anthropic's
> release cadence and that `mask` credential mode isn't available until a CLI/SDK bump?

**Recommended answer: YES — adopt (HYBRID).** Replace the OS layer, keep the gate. The
native sandbox does strictly more than the custom writer (Linux + WSL + credentials)
while deleting ~840 lines of security-critical code and a premium CI lane, and the
PreToolUse gate already covers everything the Bash-only sandbox cannot, so the "keep as
fallback" option buys little except maintenance. **The tradeoff to weigh:** you trade a
self-owned, macOS-only, fail-open writer for an Anthropic-owned, cross-platform,
fail-closed one — accepting SDK-cadence dependency (mitigated by the independent gate)
and deferring `mask` to a version-gated follow-up.

### D3 — Sandbox-by-default flip staging

> **Question:** Should the write-sandbox move from opt-in (`sandbox_sessions: false`)
> toward default-on, and if so how staged — start macOS + worktree-mode only (disjoint
> cwd, lowest false-positive surface) with a per-run opt-out and `failIfUnavailable:
> false` + a loud "containment unavailable" surface, then widen to Linux and main-mode
> once telemetry is clean; or hold at opt-in until cross-platform is proven?

**Recommended answer: YES, staged — default-on for macOS + worktree-mode first, opt-out
retained, `failIfUnavailable: false` with a loud unavailability pill, telemetry before
widening.** Worktree mode has a disjoint cwd (lowest false-positive risk), and the native
sandbox's built-in worktree `.git` handling removes the fragile custom derivation. Keep
`failIfUnavailable: false` during staging so an unsupported host degrades (with a visible
banner) rather than stranding every task; only flip to `failIfUnavailable: true` for a
future "hardened/managed" posture. **The tradeoff to weigh:** default-on matches the
governed-autonomy brand and closes the F2 Linux gap for real users, but known hook
breakage (e.g. GitKraken SessionEnd writing outside cwd) and `excludedCommands`-class
tool friction (`gh`/`docker`) will generate first-run surprises — hence opt-out +
loud surface are non-negotiable parts of the flip.
