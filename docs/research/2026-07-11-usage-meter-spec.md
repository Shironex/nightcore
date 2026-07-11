# Build spec: provider usage meter (rate-limit windows in the sidebar footer)

**Date:** 2026-07-11
**Status:** build-ready. Every decision in § 1 is locked (user-grilled 2026-07-11). Do NOT
re-litigate; implement.
**Research source (read first, authoritative for endpoint/field mechanics):**
`scratchpad/codexbar-research.md` — the CodexBar (MIT, macOS menu-bar app) teardown of the
Claude + Codex usage data paths: endpoints, auth headers, credential storage, response fields,
and the hard-won refresh gotchas (issues #1161 / #1239 / #1844 / #1114 / #1808). CodexBar is
MIT; naming it as the source of endpoint/field FACTS is fine (§ 1 decision 6 — no attribution
owed for facts; if code is ever ported, add a NOTICE line then).
**Architecture prior art (read for the codegen + module + event idioms it clones):**
`docs/research/2026-07-10-trust-report-build-spec.md` (the `cost_summary` transcript-summer this
mirrors, and the Rust-authored ts-rs contract discipline) and
`docs/research/2026-07-10-terminal-build-spec.md` (the `terminal/` managed-state registry +
async-command posture this poller mirrors).

> An implementer with no session context can build **PR A** directly from § 7 — it is fully
> testable headless (response-shape fixtures, no network). **PR B** depends on PR A's commands +
> the `nc:usage` channel. Each PR is independently green against the full gate battery (§ 8).

---

## 1. Decision record (grilled 2026-07-11 — recorded verbatim, do not reopen)

| # | Decision | Outcome |
|---|---|---|
| 1 | **Metric** | **Rate-limit windows are first-class**: per-provider `5h` / `weekly` / model-scoped `%` used + reset times, shown as the primary content. Cost-derived-from-transcripts is a **secondary** metric shown ONLY in the detail popover (labeled approximate), never on the compact bar. The two are different metrics (windows = utilization/reset; cost = local-log $ estimate) and must never be conflated. |
| 2 | **UI** | **Sidebar-footer widget** — a compact per-provider bar (used-% + reset countdown) + a **detail popover on click** (all windows, credits, local cost). **No new nav entry** (not an `AppView`, not a `CHANNELS`-gated view). |
| 3 | **Providers** | **Claude + Codex together in v1**, shaped through a per-provider seam (`UsageSnapshot { provider, windows[], credits?, updated_at, status }`, refined in § 3.1). A provider with no credentials on disk renders a **dormant "not connected" row** — never an error, never a spinner. |
| 4 | **Polling** | Fixed **10-minute** cadence (chosen over CodexBar's 5 "to be safe"), **single-flight** (one in-flight batch regardless of kicks), **cooldown on 429** (honor `Retry-After`), keep **last-good snapshot marked `stale`** on any failure, **refetch on app focus if the snapshot is ≥ 10 min stale**. **NEVER refresh OAuth tokens.** On 401/expiry, surface "run `claude` / `codex` to re-sign-in" and stop — do not self-refresh (CodexBar #1161/#1239: consuming Claude's rotating refresh token invalidates the CLI's session and force-logs-out the user). |
| 5 | **Activation** | **Opt-in.** The widget renders in a dormant "**Enable usage meter**" state until the user clicks it. The click (a) flips a serde-additive settings flag and (b) performs the **first credential read** so the macOS Keychain access prompt is a **consequence of the gesture**, not a surprise background prompt. |
| 6 | **Attribution** | Endpoint/field knowledge is used as **facts**; the Rust implementation is our own — **no attribution owed**. If any CodexBar code is ever ported verbatim, add a NOTICE line at that time. |

**Hard constraints (carried from decisions, do not violate):**
- The poller lives in the **Rust core** (§ 3.2). It owns the system seams — macOS Keychain, the
  HTTP client, and `~/.claude` / `~/.codex` file reads — and must run regardless of sidecar
  state. The Bun sidecar is per-run and does NOT own system credentials; it is the wrong tier.
- **Tokens are never logged, never surfaced, never persisted.** Credentials are read at poll time
  and dropped when the request completes; they live no longer than the request (§ 3.7).
- Every failure is **fail-soft**: dim + `stale`/degraded status, never a crash, never a blank
  widget (§ 3.6). An undocumented or shape-drifted endpoint response degrades one provider row,
  never the meter.

---

## 2. What this is (and is NOT)

A **read-only telemetry widget**. It reads OAuth credentials the user's `claude` / `codex` CLIs
already wrote, calls each provider's usage endpoint on a timer, and renders the returned
rate-limit windows in the sidebar footer. It is **NOT**:

- an agent-reachable surface (like the terminal, it is a USER-only seam — no command, event, or
  store path exposes it to a running session);
- a token manager (it never writes, refreshes, or rotates a credential — read-only, decision 4);
- a billing/admin dashboard (org spend, the Admin API, the Web-cookie and CLI-PTY fallback paths
  from the CodexBar research are all **out of v1** — OAuth-API-only, § 3.4).

The **cost** number in the popover is the ONE thing computed from local data rather than fetched:
a JSONL scan of the same session transcripts the Trust Report already sums (§ 3.8), reusing that
idiom. It is explicitly labeled approximate.

---

## 3. Design — tier by tier

### 3.1 Contracts + type flow (Rust-authored → TS via ts-rs, NOT zod)

The usage shapes are **Rust-authored** (the poller mints them from provider responses), so they
follow the `GauntletResult` / `TrustReport` codegen discipline, not the zod-first path:
`#[derive(Serialize, Deserialize)]` + `#[cfg_attr(test, derive(TS))]` +
`#[cfg_attr(test, ts(export, export_to = "…"))]`, exactly like
`workflow/trust/contract.rs:29-63`. `cargo test` (from `apps/desktop/src-tauri`) regenerates
`apps/web/src/lib/generated/*.ts`; the types are **registered in `bindings/export.rs`** next to
the `TrustReport` cluster (`bindings/export.rs:58-61,175-185`). Never hand-edit generated files.

**Home:** new file `apps/desktop/src-tauri/src/usage/contract.rs`. Content model (representative
— the section split + the additive/optional seams are locked; the exact field set is the
implementer's within them):

```rust
/// The whole-meter snapshot the web polls + the `nc:usage` push carries. One row
/// per configured provider, always present (a not-connected provider is a dormant
/// row, never absent — so the widget layout is stable). Minted per poll, held in
/// managed state; NEVER persisted with credentials (§ 3.7).
UsageMeter {
  providers: Vec<ProviderUsage>,   // claude, codex — stable order
  updated_at: Option<String>,      // ISO-8601 of the last poll that touched ANY provider
}

ProviderUsage {
  provider: String,                // "claude" | "codex" (the provider-name vocabulary,
                                   //   shared with provider::CLAUDE_PROVIDER_ID etc.)
  status: UsageStatus,             // the degraded-state enum below — drives all UI affordances
  windows: Vec<RateWindow>,        // the first-class metric (decision 1); empty for a dormant row
  credits: Option<Credits>,        // popover-only; Codex `credits`, Claude `extra_usage`
  updated_at: Option<String>,      // ISO-8601 of THIS provider's last SUCCESSFUL fetch
  stale: bool,                     // true = showing last-good after a failed refresh (decision 4)
  message: Option<String>,         // re-auth guidance / degraded reason — UNTRUSTED-free (our text)
  // NOTE: cost is NOT here. It is computed on popover open by a separate command
  // (§ 3.8), never on the 10-min poll, so the hot path stays network-only.
}

RateWindow {
  kind: String,                    // "5h" | "weekly" | "weekly_opus" | "weekly_sonnet" |
                                   //   "model:<id>" — a stable machine key
  label: String,                   // display ("Session (5h)", "Weekly", "Opus weekly", …)
  used_percent: f64,               // NORMALIZED to 0..100 at parse time (§ 3.5) — Claude sends
                                   //   0..1 utilization, Codex sends 0..100 int; normalize once
  resets_at: Option<String>,       // ISO-8601 reset instant (the countdown source)
  window_seconds: Option<u64>,     // limit_window_seconds when the provider gives it
  scope_model: Option<String>,     // display name for a model-scoped window (Opus/Sonnet/Spark)
}

Credits {                          // Codex `credits` / Claude `extra_usage`, popover-only
  has_credits: Option<bool>,
  unlimited: Option<bool>,
  balance: Option<f64>,            // Claude extra_usage: divide MINOR units by 100 (CodexBar #1114)
  currency: Option<String>,
}

/// The degraded-state machine. EVERY non-Ok state has a defined, non-crashing UI
/// (§ 3.6). This enum is the single source of "what does the widget show".
UsageStatus =
  | Ok            // fresh windows fetched
  | Stale         // transient failure; showing last-good (decision 4)
  | Unauthorized  // 401/expired → message = "run `claude`/`codex` to re-sign-in" (decision 4)
  | RateLimited   // 429; in Retry-After cooldown, showing last-good
  | NotConnected  // no credentials on disk → dormant row (decision 3)
  | Unsupported   // endpoint 4xx/5xx we don't model, or a shape we can't parse → dim, keep last-good
  | Disabled      // the meter is opt-in-off (decision 5) — the whole widget is in "Enable" state

UsageCost {                        // the § 3.8 popover-only local scan result, its OWN type
  provider: String,
  cost_usd: Option<f64>,
  tokens: Option<TokenTotals>,     // REUSE workflow::trust::TokenTotals verbatim (already ts-rs'd)
  approximate: bool,               // ALWAYS true — labeled in the render
  computed_at: String,
}
```

Reuse `workflow::trust::TokenTotals` (`workflow/trust/contract.rs:179-189`) verbatim inside
`UsageCost` — do not re-model token totals. `UsageStatus` is a serde `rename_all = "camelCase"`
externally-tagged enum → a TS string union, the same shape ts-rs gives `DiffStatus` /
`SubtaskStatus`.

### 3.2 The poller module — `usage/` (new top-level Rust module)

**Home:** new module `apps/desktop/src-tauri/src/usage/` — a peer of `provider/`, `terminal/`,
`worktree.rs` (the backend-decomposition layer discipline). It owns the system seams (Keychain,
HTTP, credential files), so it cannot live in a `store/` leaf (pure persistence) or in the
sidecar (per-run, no system-credential ownership). Files:

- `mod.rs` — facade + the `UsageRegistry` managed-state type (holds the last-good `UsageMeter`
  behind a `Mutex`, plus the poll-lifecycle atomics), mirroring `terminal::TerminalRegistry`
  (`terminal/registry.rs:27-31`) and the derived-in-memory `store::model_cache::ModelCache`
  (`lib.rs:154`).
- `contract.rs` — the § 3.1 ts-rs types.
- `poller.rs` — the 10-minute background loop (§ 3.3).
- `credentials.rs` — shared credential reads (Keychain + file fallback, § 3.4a).
- `claude.rs` — Claude fetch + the dual-shape parser (legacy flat keys AND `limits[]`, § 3.5).
- `codex.rs` — Codex fetch + parser (§ 3.5).
- `http.rs` — the one `reqwest` client (rustls), timeout + redaction helpers (§ 3.6).
- `cost.rs` — the local JSONL cost scan (§ 3.8), mirroring `store::transcript::cost_summary`.
- `tests.rs` — response-shape fixtures for BOTH Claude shapes + the Codex `wham` shape + parse /
  normalize / redaction assertions.

`UsageRegistry` is **managed state** (`app.manage(usage::UsageRegistry::new())` in `lib.rs`'s
`setup`, beside `terminal::TerminalRegistry` at `lib.rs:120`). The last-good snapshot lives in
memory only (v1) — like `ModelCache`, it is derived and cheap to re-fetch; a restart starts cold
and the first poll refills it. This dodges the entire "persisted-credential" risk surface
(decision 4 / § 3.7). Disk-persist of the *windows only* (never credentials) is a possible later
optimization, flagged in § 9, not built in v1.

### 3.3 The 10-minute poll loop (mirror the auto-loop tick driver)

Clone the auto-loop's spawn + select idiom (`orchestration/coordinator/auto_loop.rs:38-40,94-109`)
— a `tauri::async_runtime::spawn` loop (NOT bare `tokio::spawn`, which panics with no runtime —
the tested regression at `auto_loop.rs:206-234`) that `tokio::select!`s a 10-min sleep against a
`Notify` kick:

```
loop {
  if !enabled() { wait_for_enable_kick(); continue; }   // opt-in gate (decision 5)
  if single_flight.try_lock() {                          // one batch at a time (decision 4)
    for provider in [claude, codex] {
      if in_429_cooldown(provider) { continue; }         // honor Retry-After (decision 4)
      match fetch(provider) {                            // read creds → HTTP → parse
        Ok(snapshot)  => store_and_mark_ok(provider, snapshot),
        Err(Transient)=> mark_stale(provider),           // keep last-good (decision 4)
        Err(Unauthorized) => mark_unauthorized(provider),// "run claude/codex" — NO refresh
        Err(RateLimited{retry_after}) => set_cooldown(provider, retry_after),
        Err(NoCreds)  => mark_not_connected(provider),   // dormant row (decision 3)
        Err(Unsupported) => mark_unsupported(provider),  // dim, keep last-good (§ 3.6)
      }
    }
    emit_usage(app, &meter);                             // nc:usage push (§ 3.9)
  }
  select! { _ = kick.notified() => {}, _ = sleep(10 min) => {} }
}
```

- **Single-flight**: the batch holds a `try_lock`/`AtomicBool` guard so a focus-kick that lands
  mid-poll is coalesced, not stacked (the `isRefreshing` coalescing the research documents).
- **10-min cadence**: `const POLL_INTERVAL: Duration = Duration::from_secs(600);` (decision 4 —
  10, not CodexBar's 5).
- **Focus refetch**: a `refresh_usage` command (§ 3.10), invoked from a web `window` focus
  listener, kicks the `Notify` **only if** the snapshot's `updated_at` is ≥ 10 min old (decision
  4 — the staleness guard prevents a focus-storm from hammering the endpoints).
- **429 cooldown**: per-provider; parse `Retry-After` (seconds or HTTP-date); until it elapses,
  the provider is skipped and stays `RateLimited` with its last-good windows.
- The loop is **armed on enable** and **on startup if already enabled** (the persisted flag,
  § 3.7) — like the auto-loop's `start(app)` (`auto_loop.rs:27-42`). A disabled meter's loop
  parks on the enable-kick, spending zero CPU/network.

### 3.4 Data sources — OAuth API only (v1)

Only the **OAuth API** path from the research is built. The Web-cookie, CLI-PTY, Admin-API, and
off-screen-WKWebView paths are explicitly **out of v1** (each is slow/brittle/battery-heavy and
exists in CodexBar only as a fallback).

**3.4a — Credential reads (`credentials.rs`).**

- **Claude:** macOS reads the Keychain generic-password item **`Claude Code-credentials`** via the
  **`security-framework`** crate (`SecKeychain::default().find_generic_password(...)` /
  `security_framework::passwords::get_generic_password`). The blob is the SAME JSON shape as the
  file: `{ "claudeAiOauth": { "accessToken", "refreshToken", "expiresAt"(ms), "scopes"[],
  "subscriptionType", "rateLimitTier" } }`. **File fallback** for Windows / Linux / older macOS:
  `~/.claude/.credentials.json` (same shape). Read Keychain first on macOS, fall back to the file
  if the item is absent. **MCP-only trap (research #1844):** if the payload has `mcpOAuth` but no
  `claudeAiOauth`, treat it as `NotConnected` (do NOT attempt a fetch) — a Claude-Code-2.1.x state
  that carries no usable OAuth token.
- **Codex:** read `~/.codex/auth.json` (or `$CODEX_HOME/auth.json`): `{ "tokens": { "access_token",
  "account_id", … }, "last_refresh" }`. No Keychain — a plain file read on every platform.
- **Scope note (Claude):** the usage endpoint needs the `user:profile` scope. A token that only
  carries `user:inference` returns 403 with `user:profile` in the body → map to `Unsupported`
  with a `message` explaining the CLI token lacks usage scope (do NOT crash, do NOT retry-storm).

**3.4b — Claude usage fetch (`claude.rs`).**
`GET https://api.anthropic.com/api/oauth/usage`, headers:
`Authorization: Bearer <accessToken>`, **`anthropic-beta: oauth-2025-04-20`** (REQUIRED — the
endpoint is gated behind this beta flag), `Accept: application/json`, and a
**`User-Agent: claude-code/<version>`** (deliberately the Claude Code CLI UA; fall back to a
pinned `claude-code/2.1.0` if a version can't be detected). HTTP handling: `200` → parse;
`401` → `Unauthorized` (re-auth guidance, no refresh); `403` → `Unsupported` (usually scope);
`429` → `RateLimited` + `Retry-After`. 30-second request timeout.

**3.4c — Codex usage fetch (`codex.rs`).**
`GET https://chatgpt.com/backend-api/wham/usage`, headers:
`Authorization: Bearer <access_token>`, **`ChatGPT-Account-Id: <account_id>`**, a `codex-cli`
User-Agent. Same status mapping. (The `rate-limit-reset-credits` inventory call from the research
is optional and **deferred** — v1 reads `credits` off the main `wham/usage` body only.)

### 3.5 Parsing — normalize both providers into `RateWindow`, and Claude's TWO shapes

The parsers are **pure functions over `serde_json::Value`** (unit-testable against the § 7
fixtures), each returning `Vec<RateWindow>` + `Option<Credits>`:

- **Claude — parse BOTH shapes (the migration already happened once, so both are live in the
  wild):**
  1. **Legacy flat keys:** `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet`, …
     each `{ utilization: f64, resets_at: ISO8601 }`. `utilization` may be `0..1` OR `0..100` —
     normalize to `0..100` (values `≤ 1.0` are treated as fractions; a documented, tested rule).
  2. **Newer `limits[]` array** (supersedes the flat `seven_day_*`): each element
     `{ kind, group, percent, resets_at, scope.model.{id,display_name}, is_active }`. This is how
     model-scoped weekly windows (e.g. a promotional Fable/Opus limit) now arrive.
  **The parser must handle both** and de-dup: prefer `limits[]` when present, fall through to the
  flat keys otherwise. `extra_usage { used_credits, monthly_limit, currency, is_enabled }` →
  `Credits` (remember CodexBar #1114: `extra_usage` amounts are MINOR units — divide by 100).
  **#1808 guard:** an org-managed/education subscription can return a body with NO numeric windows
  → produce an empty `windows` with status `Ok` (or `Unsupported` with a clear message) — NEVER
  derive a fake `%` from spend.
- **Codex:** `rate_limit.primary_window` (5h/session lane) + `rate_limit.secondary_window` (weekly,
  `limit_window_seconds` 604800), each `{ used_percent: int, reset_at: epoch-seconds,
  limit_window_seconds }` → two `RateWindow`s (`reset_at` epoch-seconds → ISO-8601 via the crate's
  own `iso8601_utc`, `workflow/trust/aggregate.rs:208`, which is `pub(super)` today — lift it to a
  shared `infra` helper or re-implement the ~10-line civil-time function; do NOT add `chrono`).
  `additional_rate_limits[]` → model-scoped `RateWindow`s (`kind = "model:<id>"`). `credits
  { has_credits, unlimited, balance }` → `Credits`.

### 3.6 Fail-soft everywhere (the undocumented-endpoint requirement)

These are **undocumented, reverse-engineered endpoints** — they can change shape, add fields, or
return an unmodeled error at any time. Every layer is defensive:

- **Never `unwrap`/`expect` on a parsed field.** Missing/renamed fields → that window is skipped,
  not a panic. A response we can't parse at all → `Unsupported`, keep the last-good snapshot.
- **Never let one provider sink the meter.** Each provider is fetched + mapped independently; a
  Codex 500 leaves the Claude row untouched.
- **The `UsageStatus` enum is the contract for degradation** — the web renders a defined
  affordance for every variant (dim bar + tooltip for `Stale`/`Unsupported`/`RateLimited`, a
  "re-sign-in" hint for `Unauthorized`, a muted "not connected" row for `NotConnected`). There is
  no code path that yields a blank or a crashing widget.
- **Logging** at `WARN` on a degraded fetch (mirroring the scan-zero-dollar WARN precedent,
  `21080d8`) — but **redacted**: log the status + provider, NEVER the token, NEVER the raw
  `Authorization` header. `http.rs` provides a `redact(err)` that strips any `Bearer …` / token
  substrings before an error string is logged or stored in `message`.

### 3.7 Security — tokens live only as long as the request

- Credentials are read inside `fetch(provider)`, moved into the request builder, and dropped when
  the response returns. They are **never** stored in `UsageRegistry`, never in the emitted
  snapshot, never in a log line.
- The `UsageMeter` held in managed state and pushed over `nc:usage` contains only windows /
  credits / status / timestamps — **zero credential material**.
- v1 does **not** persist the snapshot to disk. If a future optimization persists windows for a
  warm start, it MUST exclude credentials and the raw provider responses (flagged § 9).
- `message` strings are our own trusted text (re-auth guidance, degraded reasons) — they never
  echo a raw endpoint body, so there is no untrusted-content rendering concern on the web side.

### 3.8 The local cost scan (popover-only, mirror the Trust Report summer)

Computed **on popover open**, NOT on the 10-min poll (decision 1 — cost is secondary, and a
whole-tree JSONL scan is heavier than a single HTTP GET). New `usage/cost.rs`, modeled directly on
`store::transcript::cost_summary` (`store/transcript.rs:340-395`, the Trust Report's summer):

- **Claude:** scan `~/.claude/projects/**/*.jsonl` (+ `$CLAUDE_CONFIG_DIR/projects` if set) for
  `type:"assistant"` lines with `message.usage`; sum per-model input / cache-read / cache-create /
  output tokens; **dedupe streaming chunks** by `message.id + requestId`; multiply by bundled
  per-model pricing → `$`.
- **Codex:** scan `~/.codex/sessions/YYYY/MM/DD/*.jsonl` (+ `archived_sessions`) for `event_msg`
  `token_count` + `turn_context` model markers.
- **mtime short-circuit cache:** hold the last result keyed by `(provider, max-mtime-seen)`; if no
  scanned file is newer than the cached mtime, return the cache without re-reading (the research's
  `cost-usage/*.json` cache, simplified to in-memory). Bounded scan window (last N days) to keep
  it cheap.
- Result is `UsageCost { approximate: true, … }` — the render always labels it "≈ approximate,
  from local session logs". Pricing tables are our own (a small `usage/pricing.rs` const map);
  this is an estimate, not a bill.

The cost scan is **its own command** (`get_usage_cost(provider)`, § 3.10) so the compact bar never
pays for it and a slow scan can't stall the poll loop.

### 3.9 Event push — `nc:usage` (mirror the background-state notify pattern)

Background Rust state already notifies the web by `app.emit(CHANNEL, &payload)` (the `nc:task` /
`nc:loop` idiom, `store/task/model.rs:29`, `orchestration/coordinator`). The poller emits the full
`UsageMeter` on every snapshot change over a new channel. Two options — **use the registry path
(recommended), not a raw-string channel**:

- **Registry path (recommended, matches `nc:task`/`nc:loop`):** add `usage: 'nc:usage'` to
  `CHANNELS` (`packages/contracts/src/channels.ts:18-43`); add a `pub(crate) const USAGE_EVENT:
  &str = "nc:usage";` in the poller and let the `contracts/mod.rs` conformance test assert it
  equals `NIGHTCORE_CHANNELS.usage` (the test at that file asserts every `*_EVENT` const matches
  its registry entry). Web subscribes via a new `onUsageEvent` in `lib/bridge/events.ts` (clone
  the `subscribeChannel(CHANNELS.x, narrow, handler)` shape, `events.ts:112-117`) with a defensive
  narrower.
  **TRAP:** adding to `CHANNELS` REQUIRES regenerating `contracts/generated.rs` (`bun run
  codegen:contracts`) and the matching Rust const, or `cargo test` + `lint:meta` codegen-drift
  reds (`channels.ts:8-13`). This is a two-tier lockstep edit — do both in the same PR.
- **Raw-string path (simpler, like `nc:issue-map`, `events.ts:205-215`):** if wiring the registry
  proves heavy, `nc:usage` can be a raw-string channel that bypasses `CHANNELS` — justified only
  because the snapshot is ALSO fetchable via the `get_usage` command (the push is a cosmetic
  freshness nudge, the command is the source of truth). Recommend the registry path since usage is
  a recurring first-class channel, not a one-off progress tick — but this is the documented escape
  hatch if the codegen lockstep is a problem.

The web's `get_usage` command (§ 3.10) is the fetch-on-mount source of truth; `nc:usage` only
saves the widget from waiting up to 10 min for the next change.

### 3.10 Commands — `commands/usage.rs` (thin, async, `spawn_blocking`)

All async + `spawn_blocking` (a sync `#[tauri::command]` freezes the WKWebView — the known trap,
`reference_tauri_command_threading`; every terminal/trust command already follows this,
`commands/terminal.rs:54-83`). Register each in `lib.rs`'s `generate_handler!` in a new `usage`
feature group.

- **`enable_usage_meter() -> UsageMeter`** — the opt-in gesture (decision 5). (a) flips the
  `usage_meter_enabled` settings flag via `SettingsStore` (§ 4), (b) performs the **first
  credential read synchronously** so the macOS Keychain prompt fires as a consequence of THIS
  click, (c) kicks the poll `Notify` and returns the initial (possibly `NotConnected`/first-fetch)
  snapshot. If the user denies the Keychain prompt, Claude resolves to `Unauthorized`/`NotConnected`
  with guidance — never a crash.
- **`disable_usage_meter() -> ()`** — flip the flag off; the loop parks on the enable-kick.
- **`get_usage() -> UsageMeter`** — return the last-good snapshot from `UsageRegistry` (no fetch;
  cheap; the fetch-on-mount source of truth). Returns a `Disabled`-status meter when opt-in-off.
- **`refresh_usage() -> ()`** — kick the poll `Notify` (single-flight-guarded), used by the web
  focus listener; internally no-ops if the snapshot is < 10 min old (decision 4 staleness guard).
- **`get_usage_cost(provider: String) -> UsageCost`** — the on-demand local scan (§ 3.8), invoked
  when the detail popover opens. `spawn_blocking` (whole-tree JSONL read).

### 3.11 Web surface — the sidebar-footer widget + popover (`components/app/UsageMeter/`)

Folder-per-component under `apps/web/src/components/app/` (a shell concern, beside `NavSidebar` /
`SidebarUnified`), the 6-file template (`UsageMeter.tsx` / `.hooks.ts` / `.types.ts` /
`.stories.tsx` / `.test.tsx` / `index.ts`) — satisfying the `@nightcore/eslint-plugin` folder /
thin-shell / hook-budget / ≤400-line gates (§ 5).

**Mount point:** the sidebar **footer** region of `NavSidebar` (`NavSidebar.tsx`), rendered
**between the awaiting-input strip (`:223-244`) and the version/GitHub row (`:265-288`)**. It is
threaded as a prop through `Sidebar` (`Sidebar.tsx:21-32`) → `NavSidebar`, so it renders in BOTH
the unified and classic layouts (both go through `NavSidebar`). Collapsed-aware: in the collapsed
66-px rail it shows an icon-only per-provider dot with the used-% as a tooltip; expanded, a
compact labeled bar + reset countdown per connected provider.

**States (drive off `ProviderUsage.status`):**
- **`Disabled`** (opt-in-off, decision 5): a single muted "**Enable usage meter**" button. Click →
  `enable_usage_meter()` (the Keychain-prompt gesture). This is the ONLY thing the widget renders
  until enabled — nothing polls, nothing prompts, before the click.
- **`NotConnected`**: a dormant, muted "<provider> — not connected" row (decision 3), no bar.
- **`Ok`/`Stale`/`RateLimited`**: compact bar(s) — the `5h` and `weekly` used-% + a reset
  countdown; `Stale`/`RateLimited` dim the bar + add a tooltip ("last updated 14 min ago" /
  "rate-limited, retrying at …").
- **`Unauthorized`**: a re-auth hint row — "run `claude` / `codex` to re-sign-in" (decision 4).
- **`Unsupported`**: a dim row + tooltip with the `message`.
- **Detail popover (on click):** ALL windows per provider (session + weekly + model-scoped), reset
  times, credits, and — lazily on open — the **local cost** via `get_usage_cost` (labeled
  approximate). Reuse the existing `popover` motion variant + the `ui` popover primitives the
  `SidebarUnified` switcher uses (`SidebarUnified.tsx:85-127`).

**Data hook (`UsageMeter.hooks.ts`):** `get_usage()` on mount → subscribe `onUsageEvent` for live
updates → a `window` `focus` listener calling `refresh_usage()`. Bridge wrappers in a new
`apps/web/src/lib/bridge/commands/usage.ts` (clone the `trust.ts` / `terminal` command-wrapper
shape). No new `AppView`, no nav row (decision 2).

**Optional Settings row:** a plain on/off toggle for `usageMeterEnabled` may also live in the
Settings screen for discoverability, but the widget's own "Enable" button is the canonical
opt-in gesture (it's the one that fires the credential read at the right moment).

---

## 4. Settings evolution (serde-additive)

One new global flag on `Settings` (`store/settings/model.rs`), matching the
`sandbox_sessions` / `terminal_webgl_enabled` idiom (`model.rs:100-131`) exactly:

```rust
/// Provider usage meter (spec 2026-07-11, decision 5): opt-in. When false (default),
/// the sidebar widget shows a dormant "Enable usage meter" button and the Rust poll
/// loop parks — zero network/Keychain access until the user opts in. Enabling reads
/// OAuth credentials to call the providers' usage endpoints (read-only; never
/// refreshes a token). Global-only (a machine/account preference, like
/// `sandbox_sessions`). Serde-additive: a settings file written before this field
/// loads as `false`.
#[serde(default)]
pub usage_meter_enabled: bool,
```

+ the matching `Option<bool>` on `SettingsPatch` (`store/settings/patch.rs`, beside
`terminal_webgl_enabled: Option<bool>` at `:172`), a `Default` of `false`
(`model.rs:344-397`), and the merge line. It rides the existing `Settings` ts-rs export
(`bindings/export.rs:91`) — a `cargo test` regenerates `Settings.ts` with the new key.

---

## 5. Codegen / lint lockstep checklist

| Concern | File | PR | Action |
|---|---|---|---|
| ts-rs export registration | `bindings/export.rs:58-61,175-185` | A | Register `UsageMeter` + `ProviderUsage` + `RateWindow` + `Credits` + `UsageStatus` + `UsageCost` beside the `TrustReport` cluster. `cargo test` regenerates `apps/web/src/lib/generated/*`. Never hand-edit. |
| `nc:usage` channel (registry path) | `packages/contracts/src/channels.ts:18-43` + `contracts/generated.rs` | A | Add `usage: 'nc:usage'`; regen `generated.rs` (`bun run codegen:contracts`); add the `USAGE_EVENT` const so the `contracts/mod.rs` conformance test passes. **Two-tier lockstep — both in one PR or `cargo test`/`lint:meta` red.** |
| Settings additive field | `store/settings/model.rs`, `patch.rs` | A | `usage_meter_enabled: bool` (`#[serde(default)]`) + `Option<bool>` patch + `Default=false` + merge line. |
| Command registration | `lib.rs` `generate_handler!` | A/B | Add each `commands::usage::*` in a new `usage` feature group. |
| Managed state | `lib.rs` `setup` (near `:120`) | A | `app.manage(usage::UsageRegistry::new())` + arm the poll loop if `usage_meter_enabled`. |
| Web folder-per-component | `packages/eslint-plugin/` rules | B | `UsageMeter/` must satisfy `component-folder-structure` / thin-shell / hook-budget; it lives under `app/` (a shell concern) — mind `no-cross-feature-imports`. Validate with `bun run lint`. |
| lint:meta / no new ESLint rule | `tools/lint-meta/`, `agent-contract-parity` | — | **Add NO new `nightcore/*` ESLint rule** (the AGENTS.md-parity trap, § 6e). `UsageMeter` is not a scan family (no scan-family-parity) and not an `AppView` (no nav-render-parity). Validate `bun run lint:meta` = zero on a clean tree. |

---

## 6. Repo-specific traps (mandatory — each has bitten this codebase or is provable here)

**(a) macOS-only Keychain code reds Linux CI clippy under `-D warnings`.** `security-framework`
and the Keychain read are macOS-only; on Linux/Windows the credential path is the file fallback,
leaving the Keychain fns unused → clippy `dead_code` fails the `rust-checks` CI job (which runs
`-D warnings`). Gate the crate as a target dependency
`[target.'cfg(target_os = "macos")'.dependencies] security-framework = "…"`, `#[cfg(target_os =
"macos")]` the Keychain module, and annotate any helper that is only reachable on macOS with
`#[cfg_attr(not(target_os = "macos"), allow(dead_code))]`. Build MUST be green on all three OSes.

**(b) `reqwest` is the first FIRST-PARTY HTTP client — but the crate tree ALREADY compiles
reqwest + rustls.** `apps/desktop/src-tauri/Cargo.toml` `[dependencies]` has NO http client — TRUE.
But `Cargo.lock` already contains **`reqwest 0.13.4` with the `rustls` feature** and
`hyper-rustls`, pulled transitively by **`tauri-plugin-updater 2.10.1`** (verified:
`Cargo.lock:2963` + the updater's dep list). So: add `reqwest` as a **direct** dependency pinned to
the version already resolved, `default-features = false, features = ["rustls-tls", "json"]` — this
adds essentially **no new transitive compile cost** (the tree already builds reqwest+rustls) and
avoids openssl/native-tls entirely. Do NOT let cargo resolve a *second, default-featured* reqwest
(that would pull `native-tls`/openssl and re-introduce the CI grief the rustls choice avoids).
This is the first-party framing to use in the PR description — it is not a from-scratch HTTP
addition. (See § 10 — flagged loudly as a plan refinement.)

**(c) ts-rs codegen is regenerate-and-diff.** New contract types export only during `cargo test`
run **from `apps/desktop/src-tauri`** (root `cargo` no-ops — no root `Cargo.toml`). Register in
`bindings/export.rs`, run `cargo test`, and **commit** the regenerated `apps/web/src/lib/generated/*`
+ `bindings/*`. A missing registration or an uncommitted regen reds the CI drift guard.

**(d) serde-additive settings.** The new flag MUST be `#[serde(default)]` with a `false` default
so a settings file written before this feature loads cleanly (§ 4). This is the invariant every
prior Settings field upholds — do not break it.

**(e) folder-per-component + no new lint rule.** `UsageMeter/` must pass the `@nightcore/eslint-plugin`
folder / thin-shell / hook-budget / no-cross-feature-import gates (`bun run lint`). **Do NOT add a
new `nightcore/*` ESLint rule** — the `agent-contract-parity` lint-meta rule fails `bun run lint`
if a wired rule isn't named in some `AGENTS.md` (the documented trap). No new rule is needed here.

**(f) undocumented-endpoint fail-soft.** Both endpoints are reverse-engineered and unversioned.
The `UsageStatus` enum + the § 3.6 defensive-parse posture are mandatory: every response is
parsed leniently (no `unwrap` on a field), a shape we can't read degrades ONE provider row to
`Unsupported`/`Stale` with the last-good kept, and nothing the endpoint returns can crash the
poller or blank the widget. Fixture-test both the happy shapes AND a garbage/empty body (§ 7).

**(g) `nc:usage` channel is a two-tier codegen lockstep.** Adding it to `CHANNELS` without
regenerating `contracts/generated.rs` + adding the matching `USAGE_EVENT` const reds `cargo test`
(the `contracts/mod.rs` conformance test) and `lint:meta` (codegen-drift). Do both edits in PR A,
or take the documented raw-string escape hatch (§ 3.9).

**(h) `iso8601_utc` is currently `pub(super)` in `workflow/trust/aggregate.rs`.** Codex reset
timestamps are epoch-seconds needing ISO-8601 formatting. Either lift the existing civil-time
helper (`aggregate.rs:208-230`) to a shared `infra` home and reuse it, or re-implement the ~20
lines in `usage/` — do NOT add `chrono` (the crate deliberately avoids a date dependency).

---

## 7. Test plan (headless where possible; clone the named idioms)

1. **Claude parser — BOTH shapes (`usage/tests.rs`, PR A).** A fixture with the **legacy flat
   keys** (`five_hour`/`seven_day`/`seven_day_opus`) and a second fixture with the **`limits[]`
   array** (model-scoped `scope.model.display_name`). Assert both produce the expected
   `RateWindow`s; assert `limits[]` is preferred when present; assert `0..1` utilization AND
   `0..100` percent both normalize to `0..100`; assert `extra_usage` minor-units → `Credits`
   divided by 100 (#1114); assert an org-managed body with no numeric windows yields empty
   `windows`, not a fabricated `%` (#1808).
2. **Codex parser (`usage/tests.rs`, PR A).** A `wham/usage` fixture with `primary_window` +
   `secondary_window` + `additional_rate_limits[]` + `credits`. Assert two lane windows + the
   model-scoped extras; assert `reset_at` epoch-seconds → ISO-8601; assert `credits` maps.
3. **Fail-soft (`usage/tests.rs`, PR A).** Feed each parser an empty body, a truncated JSON, and a
   body with renamed fields → assert `Unsupported`/empty-windows, NEVER a panic. Assert the MCP-
   only Claude payload (`mcpOAuth`, no `claudeAiOauth`) → `NotConnected`.
4. **Redaction (`usage/tests.rs`, PR A).** Assert `http::redact` strips a `Bearer <token>` and any
   token-looking substring from an error string; assert no test log line contains a token.
5. **Cost scan (`usage/cost.rs` tests, PR A).** Clone the `cost_summary` harness
   (`store/transcript.rs:549-629`): synthetic `~/.claude/projects` + `~/.codex/sessions` JSONL in a
   tempdir; assert summed tokens/`$`, streaming-chunk dedupe by `message.id + requestId`, mtime
   short-circuit returns the cache, and a no-transcript provider yields `cost_usd: None`.
6. **Poll state machine (`usage/poller.rs` tests, PR A).** Pure over an injected fetch fn: assert
   single-flight coalescing (a kick mid-batch runs one batch), 429 → cooldown skips the provider
   while keeping last-good, transient failure → `Stale` keeps last-good, 401 → `Unauthorized` with
   NO refresh call, and the enable-gate parks when disabled.
7. **Serde/ts-rs additive (`usage/contract.rs` tests, PR A).** Assert `UsageStatus` round-trips its
   camelCase union and an unknown/absent optional (`credits`, `cost`) round-trips (clone the
   serde-additive idiom, `store/task/model.rs` round-trip tests).
8. **Settings additive (PR A).** Assert a `Settings` JSON without `usageMeterEnabled` loads as
   `false` (clone the existing additive-field settings tests).
9. **Widget render + states (`UsageMeter.test.tsx` + `.stories.tsx`, PR B).** Stories for
   `Disabled` (Enable button), `NotConnected` (dormant row), `Ok` (bars + countdown), `Stale`/
   `RateLimited` (dimmed), `Unauthorized` (re-sign-in hint), `Unsupported`. Test the Enable click
   calls `enable_usage_meter`, the popover opens the cost via `get_usage_cost`, and the collapsed
   rail renders icon-only. Clone the per-status story convention from `GauntletResults`/
   `ProviderConfigPanel`.
10. **Focus refetch + subscription (`UsageMeter.hooks.ts` test, PR B).** Assert mount calls
    `get_usage`, `onUsageEvent` updates state, and a `window` focus event calls `refresh_usage`
    (mock the bridge).

---

## 8. Verification gates (run per PR)

```
bun run lint                              # eslint-plugin (folder-per-component on UsageMeter/, PR B) + parity rules
bun run lint:meta                         # lint-meta; zero violations on a clean tree (channel codegen-drift, PR A)
bun run --filter @nightcore/web typecheck # root tsc -b does NOT cover apps/web
bun run --filter @nightcore/web test      # PR B web tests
bun run codegen:contracts --check         # PR A: nc:usage channel added to CHANNELS → generated.rs must match
cargo fmt --all --check                   # MUST run from apps/desktop/src-tauri — root has no Cargo.toml, silently no-ops
cargo clippy --all-targets                # from apps/desktop/src-tauri; MUST be green on macOS AND Linux (trap a)
cargo test                                # from apps/desktop/src-tauri: parser/poller/cost tests + ts-rs regen (commit generated + bindings)
bun run dogfood:engine                    # PR B manual: enable → Keychain prompt fires on click → real windows render;
                                          #   disable parks; 401 shows re-sign-in; popover shows approximate cost
```

- **PR A** is the only PR where `cargo test` performs a real ts-rs regen (the usage bindings) —
  commit both `apps/web/src/lib/generated/*` and `bindings/*`; never hand-edit.
- **PR A** touches `channels.ts` → run `bun run codegen:contracts` and commit `generated.rs`, or
  `lint:meta` + `cargo test` red (trap g).
- **`cargo clippy` MUST be exercised on a non-macOS target** (or trust CI's Linux `rust-checks`
  job) before declaring PR A done — trap (a) only manifests off macOS.

---

## 9. PR slicing (two PRs; each independently green)

### PR A — Rust usage core (module, credentials, HTTP, contracts, commands, tests)

- **Scope:** new `usage/` module (`mod.rs`, `contract.rs`, `poller.rs`, `credentials.rs`,
  `claude.rs`, `codex.rs`, `http.rs`, `cost.rs`, `pricing.rs`, `tests.rs`); the `reqwest`
  (rustls, pinned to the lock version) + macOS-target `security-framework` deps; `commands/usage.rs`
  (`enable_usage_meter` / `disable_usage_meter` / `get_usage` / `refresh_usage` / `get_usage_cost`);
  the `nc:usage` channel (CHANNELS + generated.rs + `USAGE_EVENT`); the `usage_meter_enabled`
  Settings field + patch; ts-rs registration in `bindings/export.rs`; `UsageRegistry` managed state
  + poll-loop arming in `lib.rs` setup + `generate_handler!` wiring.
- **Encodes:** the 10-min single-flight poll loop with 429 cooldown + last-good-stale + focus
  staleness guard; OAuth-API-only fetch for both providers; the dual-shape Claude parser + Codex
  parser; NO-token-refresh 401 handling; the `UsageStatus` fail-soft machine; redaction; the
  local cost scan; opt-in enable gesture (flag + first credential read).
- **Green because:** additive module + additive commands + additive Settings field + one additive
  channel; `cargo test` regenerates/commits the ts-rs output (new unused TS files are valid — web
  typecheck unaffected). `bun run lint` / web tests are no-ops for this PR. Fully testable
  headless (fixtures, injected fetch fn — no live network).

### PR B — Web widget + popover + opt-in flow + settings toggle

- **Scope:** `apps/web/src/components/app/UsageMeter/` (6-file folder); bridge wrappers in
  `lib/bridge/commands/usage.ts`; `onUsageEvent` + narrower in `lib/bridge/events.ts`; thread the
  widget as a prop through `Sidebar` → `NavSidebar` into the footer region; the detail popover
  (all windows + credits + lazy `get_usage_cost`); the dormant "Enable usage meter" state calling
  `enable_usage_meter`; the `window` focus → `refresh_usage` listener; collapsed-rail rendering;
  optional Settings on/off row for `usageMeterEnabled`.
- **Encodes:** the sidebar-footer surface (decision 2); per-provider compact bars + reset
  countdown; the `NotConnected` dormant row (decision 3); the `Unauthorized` re-sign-in hint
  (decision 4); the opt-in-consequence-of-gesture flow (decision 5).
- **Green because:** additive UI (folder-per-component satisfies the ESLint plugin) over commands
  that already exist (PR A); `bun run lint`, web typecheck/test, cargo test all pass.

---

## 10. Deferred / out of v1 (named so they are not silently in-scope)

- **No token refresh, ever** (decision 4) — not deferred, *permanently rejected* for the direct
  path. The delegated `claude /status` "touch" refresh CodexBar uses is explicitly NOT built.
- **Fallback data paths** — Web-cookie import, CLI-PTY `/usage` scrape, Admin API org spend, and
  the off-screen-WKWebView dashboard are all OUT. OAuth-API-only.
- **Codex `rate-limit-reset-credits`** inventory call — deferred; v1 reads `credits` off the main
  `wham/usage` body only.
- **Adaptive/thermal refresh cadence** (CodexBar's Low-Power/thermal `AdaptiveRefreshPolicy`) —
  OUT; fixed 10-min only (decision 4).
- **Account-switch fingerprinting** (SHA-256-of-refresh-token history separation) — OUT for v1;
  the meter shows whatever credential is currently on disk.
- **Disk-persisting the last-good snapshot** for a warm start — OUT (in-memory only, § 3.2/§ 3.7);
  if added later it MUST exclude credentials + raw responses.
- **More providers** — the `provider` field + `Vec<ProviderUsage>` shape scales to the CodexBar
  58-provider set, but v1 ships Claude + Codex only (decision 3).
```
