# @nightcore/engine — Agent Contract

The engine is the ONLY package allowed to depend on the Claude Agent SDK, and the façade every surface reaches the model through.

## Package layout
`src/` is layered; nothing depends upward, and `index.ts` is the sole external contract (consumers import only from `@nightcore/engine`):
- `util/` — pure cross-cutting helpers (`field-extract`), depended on by everything.
- `session/` — the kernel that runs Claude SDK sessions: `session-manager` (composition root + `SurfaceCommand` dispatch), `session-runner`, `sdk-adapter` (the SDK boundary), `session-api`, `resolve-claude-binary`, `subprocess-env`, `kind-presets`.
- `policy/` — the guard layer: `permission-layer`, `question-layer`, `hook-bus`, `tool-deny-policy`, `tool-registry`.
- `scans/` — AI codebase-analyzer feature slices over a shared base: `shared/` (`manager`/`findings`/`presets` — the reusable scan toolkit, currently also the Insight orchestrator), `harness/`, `scorecard/`. A new analyzer is a new `scans/<name>/` folder importing `../shared`.
- `providers/` — read-only `provider-config` inspector.
Tests are colocated (`*.test.ts` next to the file under test).

## SDK containment
- Runtime/value use of `@anthropic-ai/claude-agent-sdk` (the `query()` runtime) lives ONLY in `src/session/sdk-adapter.ts`. Type-only `import type` of SDK shapes is allowed in engine internals (e.g. `policy/permission-layer.ts`, `policy/question-layer.ts`, `policy/hook-bus.ts`); never add a value/runtime SDK import outside `session/sdk-adapter.ts`. Surfaces and capability packages stay fully SDK-free and reach the model through the engine façade.
- Capability packages (SDK-free peers) are pulled in by the engine via dependency inversion; the engine imports them, never the reverse.

## Session semantics — degrade, don't throw
- `SessionManager`/`SessionRunner` surface failures as `session-failed` events. `run()` MUST translate errors into events and return — it must never reject.
- Session ids are monotonic and single-use: late events from a torn-down runner are dropped, and a session id is never reused. Numeric Nightcore id is `sessionId` (number); the SDK UUID is `sdkSessionId` (string) — never name an SDK UUID `sessionId`.

## Agents — native tools only, no built-in subagent presets
- The main session does NOT register `Options.agents`. Registering built-in subagent presets exposes the SDK `Agent` (Task) tool to the main model, which then delegates shell work (e.g. `bun run … build`/test) to a subagent instead of calling `Bash` directly — surfacing as confusing `Agent`/`subagent_type` entries in the logs and board transcript. Keep the main session on native SDK tools (Read/Glob/Grep/Write/Edit/Bash), matching the Claude-Code mental model. `settingSources` is purely the ambient-context (skills/commands/CLAUDE.md) loader and an empty list means strict isolation; the user's own filesystem-discovered agents come through it, not from in-code presets.
- An agent's stable identity (persona, permission mode) is injected via `appendSystemPrompt`/`Options`; per-run instructions are appended by the caller, never inlined into persona text.
- A read-only persona MUST be backed by `disallowedTools` covering all write/exec tools AND a non-prompting permission mode — prose alone never enforces read-only.
- Prompts and machine-output contracts are authored as fragment arrays joined with `.join(' ')` (prose) or `.join('\n')` (structured), not free-form template literals.

## Secrets
- Values that may carry secrets in agent context (`Options.mcpServers` `env`/`headers`, resume/session ids) are logged at `logger.debug` only — never at info/telemetry.

## Testing
- Engine/sidecar tests inject a scripted fake `query()` and mock the session-store FS functions. No test reaches the real SDK or `~/.claude`.