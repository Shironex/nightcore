# @nightcore/tui

Nightcore's interactive terminal surface — an OpenTUI + React view over the
`@nightcore/engine` event stream. The surface speaks **only** `SurfaceCommand` /
`NightcoreEvent`; it never imports the Claude Agent SDK (enforced by eslint).

## Run

Requires a TTY and your local Claude CLI credentials (`~/.claude`). It cannot run
in a non-interactive shell.

```bash
bun run apps/tui/src/index.ts
# or, from the repo root:
bun run tui
```

## Keybindings

| Key         | Action                                                        |
| ----------- | ------------------------------------------------------------ |
| `Enter`     | Submit the prompt (starts a session, or sends follow-up input) |
| `Shift+Tab` | Toggle permission mode: **plan** (read-only) ↔ **build** (acceptEdits) |
| `Esc`       | Interrupt the running session (or **deny** a pending permission) |
| `y`         | Approve the pending permission request                       |
| `n`         | Deny the pending permission request                          |
| `Ctrl+C`    | Quit                                                          |

Multi-line input: the prompt box is a `<textarea>`; `Shift+Enter` inserts a
newline (native textarea behaviour), `Enter` submits.

## Layout

```
┌ SessionHeader ─ model · mode · status · cost ┐
│ StreamView ─ scrollable transcript            │
│   assistant deltas, tool calls, tool results  │
│ PermissionPrompt ─ shown when approval needed │
│ InputBox ─ multi-line prompt                  │
│ FooterHints ─ keybinding hints                │
└───────────────────────────────────────────────┘
```

## Architecture

- `src/index.ts` — entry: resolves config, builds `SessionManager`, mounts `<App>`.
- `src/App.tsx` — layout + global keybindings.
- `src/useSession.ts` — the single engine-subscription hook; folds the event
  stream into a view via `session-reducer.ts` and exposes typed command dispatchers.
- `src/session-reducer.ts` — pure reducer; replicates the CLI's partial-delta dedup.
- `src/components/` — `SessionHeader`, `StreamView`, `InputBox`, `PermissionPrompt`,
  `FooterHints`.
