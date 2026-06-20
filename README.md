# Nightcore

**A thin, fast CLI/TUI harness — powered by Claude.**

Nightcore is a personal dev tool that wraps the
[Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk).
The SDK is thick — it already owns the agent loop, built-in tools, subagents,
MCP, hooks, permission modes, and session persistence. Nightcore is the thin
shell around it: a process supervisor plus a CLI (and, soon, a TUI) surface.

> Local-first, single-user, Claude-only. No server, no database, no accounts.
> State lives under `~/.nightcore/` and per-project `.nightcore/`.

## Requirements

- **[Bun](https://bun.sh) ≥ 1.1** (runtime — Nightcore runs TypeScript directly,
  no build step). Node 22 also works for the libraries.
- **The Claude CLI, installed and logged in.** Nightcore does **not** handle
  credentials. The Agent SDK's bundled binary inherits your local Claude
  credentials from `~/.claude`.

## Setup

```bash
# 1. Install the Claude CLI and authenticate (one-time, your responsibility):
#    follow https://code.claude.com/docs and run its login.

# 2. Install workspace dependencies:
bun install

# 3. Typecheck the workspace:
bun run typecheck
```

`ANTHROPIC_API_KEY` is honored as an optional fallback if present in your
environment, but the intended path is your local Claude CLI login. Nightcore
never passes an API key itself and never brokers or persists tokens.

## Usage

Headless CLI (working today):

```bash
bun run apps/cli/src/index.ts "list the files in this directory and summarize them"

# or, after `bun link` / install, via the bin:
nightcore -m claude-opus-4-8 "say hello"
```

It starts a session, streams the assistant's output to **stdout**, and prints
session/tool activity to **stderr** (so stdout stays pipeable).

### Manual smoke test

The real model call needs your auth, so verify it manually after logging into
the Claude CLI:

```bash
bun run apps/cli/src/index.ts "say hello in one short sentence"
```

Expected: a `▶ session …` line on stderr, streamed assistant text on stdout, and
a `■ done` summary. If you see `✗ failed (authentication)`, your Claude CLI login
isn't being picked up — re-run the CLI login.

The TUI is a stub for now:

```bash
bun run apps/tui/src/index.ts   # prints "coming soon"
```

## Workspace layout

```
packages/
  contracts/   the spine — Zod schemas + types (events, commands, config, …)
  shared/      logger, Result<T,E>, monotonic ids, path helpers
  config/      layered config resolver (defaults → ~/.nightcore → ./.nightcore)
  storage/     local session-metadata store (JSONL; transcripts stay with the SDK)
  engine/      SessionManager, SessionRunner, ToolRegistry, PermissionLayer, HookBus
  tools/       in-process SDK MCP tools (echo, read_file)
  skills/      subagent presets (placeholder)
  mcp/         external MCP server configs (placeholder)
apps/
  cli/         headless CLI (working)
  tui/         terminal UI (stub)
tools/codegen/ `bun run new:tool` scaffolder
docs/          architecture summary + links to the design docs
```

See [`docs/architecture.md`](docs/architecture.md) for the layer model and
dependency rules.

## Scripts

| Command | What |
|---------|------|
| `bun run typecheck` | `tsc -b` across the workspace |
| `bun run cli "<prompt>"` | run the headless CLI |
| `bun run tui` | run the TUI stub |
| `bun run new:tool <name> "<desc>"` | scaffold a new tool |
| `bun run lint` | eslint (flat config) |

## Status & roadmap

Foundation scaffold. Deferred (see `docs/architecture.md`):

- Worker-isolation spike (in-process vs OS-level per-session boundary).
- `bun build --compile` single-binary packaging spike.
- Full TUI (OpenTUI/Ink + React, plan-vs-build, interactive approvals).
- Flesh out tools/skills/mcp; finish the `new:tool` codegen.

## License

MIT © Shirone. Not affiliated with Anthropic. "Powered by Claude" — Nightcore is
not "Claude Code" and does not redistribute Claude credentials.
