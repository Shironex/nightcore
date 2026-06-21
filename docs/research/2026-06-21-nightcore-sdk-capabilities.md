# Research: Claude Agent SDK capabilities → Nightcore implementation plan

**Date:** 2026-06-21
**Agent:** kirei
**Status:** complete
**SDK pinned:** `@anthropic-ai/claude-agent-sdk@0.3.185` (verified in `node_modules`)

## Problem

Map five official Agent SDK doc areas (slash-commands, skills, plugins,
todo-tracking, the TypeScript reference) onto Nightcore's current
engine/contracts/surface architecture, and produce a prioritized,
package-specific implementation plan. Verified every claim against the
**installed** `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`, not just
the docs (the docs lag the pinned version in two material ways — see below).

## Prioritized summary

| # | Capability | Priority | Effort | One-line proposal |
|---|-----------|----------|--------|-------------------|
| 1 | **Todo / Task panel** | **P0** | **M** | Translate `TaskCreate`/`TaskUpdate` tool_use (+ `task_*` system msgs) into a new `task-updated` NightcoreEvent and render a live task panel in the TUI. Highest-visibility win. |
| 2 | **Surface SDK slash-commands in the palette** | **P0** | **S** | Read `slash_commands` off the `init` system message into `session-ready`, merge with our surface registry in `/help` + completion, forward unknown `/x` as a normal prompt. |
| 3 | **`settingSources` + `skills` options** | **P1** | **S** | Add explicit `settingSources: ['user','project','local']` and `skills: 'all'` to the run `Options` so dropped-in `.claude/skills` and `.claude/commands` actually load. Repurpose empty `@nightcore/skills`. |
| 4 | **`result` usage/cost surfacing** | **P1** | **S** | Carry `usage` + `duration_ms` from the `result` message into `session-completed`; render token/cost/duration in the TUI footer. |
| 5 | **`commands_changed` live refresh** | **P1** | **S** | Handle `SDKCommandsChangedMessage` → re-emit the merged command list so the palette stays correct after mid-session skill discovery. |
| 6 | **Plugins (`plugins` option)** | **P2** | **M** | Wire `plugins: SdkPluginConfig[]` from config; thin pass-through. Defer UI. Honest verdict: low ROI for v1 — skills+commands cover 90%. |
| 7 | **Session resume / fork** | **P2** | **M** | Add `resume`/`forkSession` to `Options` + a `resume-session` SurfaceCommand once `@nightcore/storage` persists SDK session ids. Foundation exists (`sdkSessionId` already captured). |
| 8 | **`thinking` option + thinking-token meter** | **P2** | **S/M** | Pass `thinking` option; optionally render `SDKThinkingTokensMessage` as a spinner pill. |

---

## 1. Todo / Task tracking — **P0, M** (detail-most)

### What the SDK gives us (verified)

The docs page still leads with `TodoWrite`, but **the installed SDK (0.3.185)
is past the 0.3.142 migration**, so the default path is the **Task tools**, not
`TodoWrite`. Two parallel signals exist:

**(a) Tool-call signal** — the model emits `tool_use` blocks in `assistant`
messages:
- `TaskCreate` input: `{ subject, description, activeForm?, metadata? }`. The
  assigned id is **not** in the input — it comes back in the matching
  `tool_result` as `{ task: { id, subject } }`.
- `TaskUpdate` input: `{ taskId, status?, subject?, description?, activeForm?, ... }`
  where `status ∈ 'pending'|'in_progress'|'completed'` plus `'deleted'`.
  Key names are unreliable on the wire — read `taskId ?? id ?? task_id` and
  `activeForm ?? active_form` defensively (per the docs migration note).
- Legacy `TodoWrite` (`{ todos: [{ content, status, activeForm }] }`) still
  appears if `env.CLAUDE_CODE_ENABLE_TASKS=0`; worth tolerating for robustness.

**(b) System-message signal** — cleaner and id-stable. The SDK emits dedicated
system messages (all carry `task_id`, `uuid`, `session_id`):
- `SDKTaskStartedMessage` `{ subtype:'task_started', task_id, description, subagent_type?, task_type?, workflow_name?, skip_transcript? }` (`sdk.d.ts:4052`)
- `SDKTaskUpdatedMessage` `{ subtype:'task_updated', task_id, patch:{ status?, description?, end_time?, error?, is_backgrounded? } }` (`sdk.d.ts:4076`)
- `SDKTaskProgressMessage` `{ subtype:'task_progress', task_id, description, usage:{ total_tokens, tool_uses, duration_ms }, last_tool_name?, summary? }` (`sdk.d.ts:4030`)
- `SDKTaskNotificationMessage` `{ subtype:'task_notification', task_id, status:'completed'|'failed'|'stopped', summary, output_file, usage? }` (`sdk.d.ts:4012`)

These are gated by `todoFeatureEnabled?: boolean` in `Options` (`sdk.d.ts:6016`).
`skip_transcript: true` marks ambient tasks the spec says to hide from the
transcript but still show in a panel.

> **Recommendation:** prefer the **system-message** signal (b). It is id-keyed,
> wire-stable, and decoupled from whether the model used Task vs Todo. Treat the
> `task_started`/`task_updated`/`task_progress`/`task_notification` family as the
> source of truth. Optionally also catch `TodoWrite` tool_use as a fallback for
> sessions where Tasks are disabled.

### Map to Nightcore

Currently `sdk-adapter.ts` `translateMessage()` only handles `system`(init),
`assistant`, `stream_event`, `result`; everything else falls through `default:
{ events: [] }` (`sdk-adapter.ts:96`) — so **task messages are silently
dropped today.**

### Proposal

1. **`packages/contracts/src/events.ts`** — add a `TaskUpdatedEvent`:
   ```
   type:'task-updated', sessionId, taskId, status:'pending'|'running'|'completed'|'failed', description, activeForm?, summary?, isBackgrounded?, hidden?
   ```
   Add to `NightcoreEventSchema` discriminated union. Normalize the SDK's
   `'in_progress'/'killed'/'paused'/'stopped'` onto a small Nightcore status set.
2. **`packages/engine/src/sdk-adapter.ts`** — extend the `system` branch of
   `translateMessage` (`:87`) to switch on `msg.subtype` for
   `task_started|task_updated|task_progress|task_notification` and produce
   `task-updated` events. Pure/synchronous — fits the existing unit-test style
   (`sdk-adapter.test.ts`).
3. **`packages/engine/src/session-runner.ts`** — set `todoFeatureEnabled: true`
   in the `options` object (`:108`).
4. **TUI** — fold task events into `session-reducer.ts` (a `Map<taskId, Task>`
   on the `SessionView`) and add `apps/tui/src/components/TaskPanel.tsx`
   rendered by `StreamView`/`App.tsx`. Show `completed/total` + the active
   `activeForm`. This is the visible payoff.

### Gotchas
- Use `task_id` as the map key, never array index (Task tools mutate by id).
- Hide `skip_transcript`/ambient tasks from the transcript but allow them in the
  panel.
- Defensive key reads if you also parse `TaskUpdate` tool_use input.

---

## 2. Slash commands — **P0, S**

### What the SDK gives us (verified)

- **`init` system message already lists them.** `SDKSystemMessage`(init) has
  `slash_commands: string[]`, plus `skills: string[]`, `plugins: {name,path}[]`,
  `agents?: string[]` (`sdk.d.ts:` SDKSystemMessage block). This is the *simplest*
  source — no extra round-trip.
- **`Query.supportedCommands(): Promise<SlashCommand[]>`** (`sdk.d.ts:2263`) for
  richer data: `SlashCommand = { name, description, argumentHint, aliases? }`
  (`sdk.d.ts:6076`). Caveat baked into the types: `supportedCommands()` is
  captured once at init and **does not reflect mid-session changes** — re-fetch
  returns the stale list (`sdk.d.ts:2697`).
- **`SDKCommandsChangedMessage`** `{ subtype:'commands_changed', commands: SlashCommand[] }`
  (`sdk.d.ts:2699`) is the push you must use to stay current; clients should
  REPLACE their cached list.
- **Invocation:** send `/name args` as the prompt string (no special API). Only
  non-interactive commands are dispatchable.
- **Custom commands** come from `.claude/commands/*.md` (legacy) and
  `.claude/skills/*/SKILL.md` (current), loaded via `settingSources` (see §3).

### Map to Nightcore

Nightcore's slash system is **surface-only and disjoint** from the SDK's:
`apps/tui/src/commands/{registry,parse,types}.ts` handle `/help /clear /model
/doctor /quit` entirely in the TUI; `parse.ts` says "the engine never sees
these." There is **no bridge** to SDK-native `/compact`, `/context`, `/usage`,
or user-authored `.claude/commands`.

### Recommendation (decisive)

**Hybrid, not separate.** Keep surface commands as the *authoritative* layer for
anything that manipulates the TUI (`/help /clear /model /doctor /quit` —
these have no SDK equivalent and must stay client-side). For everything else:

1. Capture `slash_commands` from the init message into the `session-ready`
   event so the surface knows the SDK's command set.
2. In `runCommand` (`apps/tui/src/commands/registry.ts:72`), change the unknown
   branch: if the name is **not** a surface command but **is** in the SDK list
   (or simply any `/x`), **forward it as a prompt** (`send-input` /
   `start-session`) instead of printing "unknown command".
3. Merge both lists in `/help` and in input completion so the palette shows
   SDK + custom + surface commands in one place.
4. Handle `commands_changed` to refresh the cached list mid-session.

Do **not** call `supportedCommands()` as the primary source — the init message
already carries it and `supportedCommands()` is documented stale post-init.

### Proposal
- **`packages/contracts/src/events.ts`** — add `slashCommands: string[]` (or a
  richer `{name,description,argumentHint}[]`) to `SessionReadyEvent`.
- **`packages/engine/src/sdk-adapter.ts`** — `translateSystem` (`:112`) already
  reads `msg.model`/`msg.tools`; also read `msg.slash_commands` (and `skills`,
  `plugins`). Add a translate case for `commands_changed` → a small
  `commands-changed` event (or reuse `session-ready` shape).
- **`apps/tui/src/commands/registry.ts`** — forward-unknown-as-prompt + merged
  `/help`.

---

## 3. Skills — **P1, S**

### What the SDK gives us (verified)

- Skills are **filesystem-only** (`.claude/skills/<name>/SKILL.md`); the SDK has
  **no programmatic skill-registration API** (docs are explicit). Discovery is
  governed by `settingSources` — needs `'user'` and/or `'project'`.
- **`Options.skills?: string[] | 'all'`** (`sdk.d.ts:1845`): omitted = CLI
  defaults apply (NOT off); `'all'` = enable every discovered skill; `string[]`
  = allowlist by SKILL.md `name` / dir name / `plugin:skill`. Setting it
  auto-adds the `Skill` tool to `allowedTools`.
- **`Options.settingSources?: SettingSource[]`** where
  `SettingSource = 'user'|'project'|'local'` (`sdk.d.ts:6061`). **Omitted =
  load all** (CLI default); `[]` = isolation (no skills, no CLAUDE.md). Must
  include `'project'` to load CLAUDE.md.
- Init message reports discovered `skills: string[]`; `reloadSkills()`
  (`sdk.d.ts:2329`) and `commands_changed` cover dynamic discovery.
- SDK-side tool restriction is via the main `allowedTools` — the
  `allowed-tools` frontmatter is CLI-only and ignored by the SDK.

### Map to Nightcore

`@nightcore/skills` is **mislabeled**: it defines `SkillDefinition` =
SDK `AgentDefinition` (subagent presets `reviewer`/`builder`), not SDK *Skills*.
That's actually subagents, which belong in `Options.agents:
Record<string, AgentDefinition>` (`sdk.d.ts:1279`) — and they're **not wired in**
either. `session-runner.ts` never sets `agents`, `skills`, or `settingSources`.

### Proposal

To let users "drop a skill in and have it work":
1. **`packages/engine/src/session-runner.ts`** — in `options` (`:108`) add
   `settingSources: ['user','project','local']` (or read from config) and
   `skills: 'all'` (or a config allowlist). This alone makes `.claude/skills`
   and `.claude/commands` live.
2. **Repurpose `@nightcore/skills`** — either (a) rename its content to
   `nightcoreAgents` and feed `Options.agents` (these are subagents), and (b)
   add a *real* skills concern: a tiny helper that resolves/validates a skills
   allowlist from config, or ship starter `.claude/skills/*/SKILL.md` templates.
3. Surface discovered skills in the palette (they appear in init `skills` and as
   `/name` in `slash_commands`) — falls out of §2 for free.

### Gotcha
Nightcore's README touts "SDK isolation"/local-first. Setting `settingSources`
broadly **re-enables loading the user's global `~/.claude` settings + CLAUDE.md**.
That is a deliberate posture change — make it a config toggle, default decided
with the user (see Open Questions).

---

## 4. Plugins — **P2, M** (honest cost/benefit)

### What the SDK gives us (verified)

- **`Options.plugins?: SdkPluginConfig[]`** (`sdk.d.ts:1683`),
  `SdkPluginConfig = { type:'local', path, mcpServersFromSdk? }`
  (`sdk.d.ts:3766`). Only `type:'local'` is supported — marketplace/remote
  plugins must be downloaded first.
- A plugin bundles skills + agents + hooks + MCP + (legacy) commands. Path =
  plugin root (parent of `skills/`, `agents/`, `hooks/`, `.claude-plugin/`).
  Manifest `.claude-plugin/plugin.json` is optional (auto-discovered).
- Loaded plugins appear in init `plugins: {name,path}[]`; skills/commands are
  namespaced `plugin:skill`. `Query.reloadPlugins()` (`sdk.d.ts:2323`) reloads.

### Honest verdict for Nightcore v1: **defer (P2).**

Plugins are a *packaging* layer over capabilities Nightcore can already get more
cheaply: a bare `.claude/skills` dir + `settingSources` (§3) covers
skills+commands; `Options.mcpServers` + `@nightcore/mcp` covers MCP;
`Options.agents` covers subagents; `Options.hooks` + `HookBus` covers hooks.
Plugins add value only when you want to **distribute** a bundle. For a
single-user, local-first tool that's premature. The wiring itself is trivial
(pass-through), so it's cheap to add later when a real bundle-distribution need
appears.

### Minimal proposal (if/when wanted)
- **`packages/config/`** — add a `plugins: {path:string}[]` config key.
- **`packages/engine/src/session-runner.ts`** — map to
  `plugins: cfg.plugins.map(p => ({ type:'local', path: p.path }))`.
- No new contract types needed; loaded plugins surface through init
  `plugins`/`skills`/`slash_commands` (reuse §2/§3 plumbing).

---

## 5. TypeScript reference — Options/Query we should adopt

Audited against `session-runner.ts` `options` (`:108`) and the `Query` methods
we proxy. Today we use: `model`, `permissionMode`, `includePartialMessages`,
`canUseTool`, `mcpServers`, `hooks`, `abortController`, `effort`, `cwd`,
`executable`, `stderr`, `pathToClaudeCodeExecutable`; and `interrupt`,
`setModel`, `setPermissionMode`, `supportedModels`. **Gaps worth closing:**

| Option / method | Where in types | Why adopt | Pri |
|---|---|---|---|
| `settingSources` | `sdk.d.ts:1822` | Gate skills/commands/CLAUDE.md loading explicitly instead of silent CLI default | P1 (§3) |
| `skills` | `sdk.d.ts:1845` | Turn skills on deterministically | P1 (§3) |
| `agents: Record<string,AgentDefinition>` | `sdk.d.ts:1279` | Actually wire the `@nightcore/skills` presets as subagents | P1 |
| `todoFeatureEnabled` | `sdk.d.ts:6016` | Enable task system messages | P0 (§1) |
| `result.usage` / `total_cost_usd` / `duration_ms` | `SDKResultMessage` | We drop `usage` + `duration_ms` today — surface tokens/latency in TUI | P1 (§6 below) |
| `thinking` option + `SDKThinkingTokensMessage` | types | Control + visualize reasoning budget | P2 |
| `resume` / `continue` / `forkSession` / `resumeSessionAt` | `sdk.d.ts:1713-1727,1297,1412` | Session continuation; we already capture `sdkSessionId` | P2 (§7) |
| `Query.getContextUsage()` | `sdk.d.ts` | `/context`-style panel | P2 |
| `Query.supportedAgents()` / `supportedCommands()` / `mcpServerStatus()` | `sdk.d.ts:2259-2270` | Richer `/doctor` + palette | P2 |
| `Query.reloadSkills()` / `reloadPlugins()` | `sdk.d.ts:2323-2329` | Hot-reload after dropping a skill in | P2 |
| `includePartialMessages` nuance | already on | Note: we already translate `stream_event` text_delta (`sdk-adapter.ts:162`); good. Keep both the partial-delta and whole-block paths to avoid double-render. | — |

### 6. Result usage/cost — **P1, S**
`translateResult` (`sdk-adapter.ts:188`) reads `result/total_cost_usd/num_turns`
but ignores `usage: NonNullableUsage` and `duration_ms`. Add `usage` +
`durationMs` to `SessionCompletedEvent` and render input/output tokens, cost,
and wall-clock in the TUI footer/header. Tiny change, real signal.

---

## Files to modify

- `packages/contracts/src/events.ts` — add `TaskUpdatedEvent`; extend
  `SessionReadyEvent` with `slashCommands`/`skills`; extend
  `SessionCompletedEvent` with `usage`/`durationMs`; register in the union.
- `packages/engine/src/sdk-adapter.ts` — handle `task_*` + `commands_changed`
  system subtypes; read `slash_commands`/`skills`/`plugins` in `translateSystem`;
  carry `usage`/`duration_ms` in `translateResult`.
- `packages/engine/src/session-runner.ts` — add `todoFeatureEnabled`,
  `settingSources`, `skills`, `agents`, (later) `plugins`, `resume` to `options`.
- `apps/tui/src/session-reducer.ts` — reduce `task-updated` into a task map.
- `apps/tui/src/components/TaskPanel.tsx` *(new)* — live task panel.
- `apps/tui/src/commands/registry.ts` — forward-unknown-as-prompt; merged `/help`.
- `packages/config/src/index.ts` + `packages/contracts/src/config.ts` — config
  keys for `settingSources`, `skills`, (later) `plugins`.

## Reference files (do not modify)
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — type source of truth.
- `packages/engine/src/sdk-adapter.test.ts` — pattern for the translate tests.

## Risks & gotchas
- **`settingSources` re-opens `~/.claude`** — a posture change vs README's
  isolation framing. Make it an explicit, defaulted config toggle.
- **Docs lag the pinned SDK**: todo docs lead with `TodoWrite` but 0.3.185 uses
  Task tools by default. Build for Task tools; tolerate `TodoWrite`.
- **`supportedCommands()` is stale post-init** by design — rely on init message
  + `commands_changed`, not re-fetch.
- **Task tool_use input key names are unreliable** — read defensively if you
  parse tool_use; prefer the system-message signal.
- Avoid double-rendering deltas: keep the existing partial vs whole-block split.

## How to verify
1. `bun run apps/cli/src/index.ts "make a plan with several steps and track it"`
   (after §1) → confirm `task-updated` events on stderr.
2. TUI: same prompt → live task panel updates pending→running→completed.
3. Drop `.claude/skills/hello/SKILL.md`, run, type `/hello` → it executes (§2/§3).
4. After a session, footer shows tokens + cost + duration (§6).
5. Unit: extend `sdk-adapter.test.ts` with task + init-with-slash_commands cases.

## Open questions
- **Isolation posture:** default `settingSources` to `[]` (strict local-first,
  user opts in) or to all sources (skills "just work")? Needs a product call.
- Should `/help` visually group surface vs SDK vs custom-skill commands, or
  present one flat list?
- Persist SDK `sessionId` in `@nightcore/storage` now to unblock resume (§7), or
  defer until a resume UX is designed?
