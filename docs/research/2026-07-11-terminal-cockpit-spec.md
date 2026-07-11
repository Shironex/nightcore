# Build spec: terminal cockpit run (large upgrade to the shipped terminal)

**Date:** 2026-07-11
**Status:** build-ready. Every decision in § 1 is locked (user-grilled 2026-07-11). Do NOT
re-litigate; implement.
**Extends (read first, authoritative for the base architecture + hard constraints):**
`docs/research/2026-07-10-terminal-build-spec.md` — the shipped global tabbed terminal:
Rust `terminal/` registry (cap 8, binary `ipc::Channel` output, `portable-pty` spawn,
`.nightcore/terminals/<id>.json` scrollback, opt-in macOS Seatbelt confinement), the web
`components/terminal/` feature (module-level xterm session manager, tabs, NewTabPicker,
FolderBrowserDialog, read-only restore tabs), and the **USER-ONLY seam** rule.
**Idiom prior art (read for the codegen / settings / trap-format discipline it clones):**
`docs/research/2026-07-11-usage-meter-spec.md` (serde-additive Settings evolution, ts-rs
regen-and-diff, the canonical trap-list format).

> This spec is a **cockpit** upgrade layered on the shipped terminal — it does not rewrite the
> Rust backbone. PRs 1–5 are additive over the existing registry / session-manager / view and
> each is independently green. **PR 6 (live-PTY survival across restarts) is the only structural
> change and ships LAST** as its own PR; nothing in PRs 1–5 may depend on it.

---

## 1. Decision record (grilled 2026-07-11 — recorded verbatim, do not reopen)

| # | Decision | Outcome |
|---|---|---|
| 1 | **Layout** | Tabs stay the default; add a **tabs⇄grid view-mode toggle**. Grid = **count-driven auto-layout** (a **flat CSS sibling grid keyed by session id** — our module-level xterm session manager already survives React reorder/unmount, so a flat grid reorders without re-opening any xterm), **@dnd-kit drag reorder** (already a board dependency), **zoom-one-pane** via a header button + **Cmd/Ctrl+Shift+E**. View mode + pane order are **persisted** (additive persistence). |
| 2 | **Task→terminal injection** | The terminal header gains a **task dropdown**; picking a task composes `title + description + the task's on-disk JSON path (.nightcore/tasks/<id>.json)` and writes it into the PTY via the existing **`terminal_write`** seam, **WITHOUT a trailing newline** (the user presses Enter), **wrapped in bracketed-paste framing** so multiline text can't execute line-by-line in a bare shell. Linkage: a **linked terminal takes the task title as its name**; the **task card shows a terminal chip**. Injection is a **human gesture into the human's PTY** — the USER-ONLY seam from the predecessor spec is preserved (no agent-reachable path). |
| 3 | **Governance boundary** | Task-linked / Claude-launched terminals show an **"ungoverned session" marker** (tooltip: *runs as you, outside gates / flight-recorder / gauntlet; terminal work can never mark a task verified*). A **one-click `claude` launch** affordance (composed `cd` + launch command typed into the PTY) with **env hygiene at spawn** (strip `CLAUDECODE` / `ANTHROPIC_API_KEY` / provider env from the PTY environment in `session.rs`). Restored / read-only tabs get a **resume affordance** (`claude --continue` composed command). A **YOLO launch flag** (adds `--dangerously-skip-permissions` to the composed command) exists but is **settings-gated, DEFAULT OFF**, with an explicit warning label. |
| 4 | **Worktrees** | The new-tab picker gains a **"create new worktree" path** (name → branch toggle → base-branch picker, **reusing the existing branch-picker + worktree creation machinery** — **no dep-symlink or auto-push options**), then opens the terminal in the new worktree. Reverse affordance: **task worktrees get an "open terminal here" action**. The **worktree-cleanup interlock** (block cleanup with a confirm when a terminal is open in it) extends to these. |
| 5 | **Naming** | **Manual rename only** (double-click a tab / pane title → inline edit). Title stored on the **Rust session descriptor** (serde-additive, survives restore). Task-linked terminals **auto-take the task title**. **NO AI auto-naming in v1.** |
| 6 | **Ergonomics — all five** | (a) shortcuts **⌘T** new / **⌘W** close / **⌘⇧E** zoom + Kbd hints; (b) **smart ⌘C** (copy selection else SIGINT), platform paste keys, **Shift+Enter → ESC+\n** multiline, **1 MB paste cap**, **⌘Backspace kill-line**; (c) **unread-output activity badge** on inactive tabs/panes (increment in the Channel callback when the session isn't visible, clear on focus) — **generic, NOT Claude-output-regex parsing** (explicitly rejected as brittle); (d) **@xterm/addon-search + @xterm/addon-web-links** (links open via the Tauri opener); (e) settings: **font size + scrollback length** (slim — reactive `xterm.options` updates via the session manager). |
| 7 | **Guardrails** | Session cap **8 → 12** (constant + tests). AND **live-PTY survival across app restarts** — a **detached daemon** process owns the PTYs; the app reattaches over IPC on relaunch. This is the **riskiest item: it ships LAST as its own PR** and everything else must land without depending on it. |

**Hard constraints carried forward (do not violate):**

- **USER-ONLY seam.** No command, event, or store path may make a PTY (or the new daemon socket,
  task-injection, or worktree-create command) reachable from an agent session. The PreToolUse
  confinement gate and the flight recorder never see the terminal, by design. Task **injection**
  writes into the human's own PTY on an explicit click — it is NOT the agent driving a shell.
- **Terminal work can never mark a task Done/verified** (decision 3). The task↔terminal link is a
  convenience label + context injection only; it does not touch task status, the run lifecycle,
  gates, gauntlet, or the flight recorder.
- **Scrollback may contain secrets.** `.nightcore/terminals/` stays excluded from any export /
  Trust-Report surface by default (predecessor § 1). The daemon's on-disk buffer (PR 6) inherits
  the same exclusion + owner-only perms.
- **Additive-only backend for PRs 1–5.** `TerminalSessionInfo`, `PersistedScrollback`, and
  `Settings` all evolve serde-additively (every prior field already does). No breaking migration.

---

## 2. What exists today (grounding — verified against the shipped tree)

The cockpit builds on these, unchanged unless a PR says so:

- **Rust `apps/desktop/src-tauri/src/terminal/`**: `registry.rs` (`MAX_LIVE_SESSIONS = 8`, spawn/
  write/resize/kill/list/sessions_in_dir + lazy dead-reap), `session.rs` (`PtySession::spawn`,
  reader+coalescer threads, `build_command` env seam, `SpawnOpts`), `shell.rs` (pure injectable
  platform shell resolution), `scrollback.rs` (~10k-line ring + coalescer), `persist.rs`
  (`.nightcore/terminals/<id>.json`, `v:1`, every field `#[serde(default)]`, atomic write,
  30-day + vanished-cwd prune), `confine.rs` (opt-in macOS Seatbelt, fail-closed), `types.rs`
  (`TerminalSessionInfo` / `PersistedTerminalInfo` / `PersistedTerminalScrollback`, ts-rs on
  `cargo test`).
- **Commands `commands/terminal.rs`**: `terminal_spawn` (wraps the binary `Channel` as the output
  sink), `terminal_write` (`data: Vec<u8>` → `writer.write_all`), `terminal_resize`,
  `terminal_kill`, `terminal_list`, `terminal_sessions_in_dir`, `terminal_list_persisted`,
  `terminal_read_persisted`, `terminal_delete_persisted`. All async + `spawn_blocking`.
- **Web `apps/web/src/components/terminal/`**: `terminal-session-manager.ts` (module-level
  `Map<sessionId, CachedSession>` — the remount-surviving xterm owner; `openSession` creates+spawns,
  `attachSession` moves a persistent host element between panes, `closeSession`, `reconcileSessions`),
  `TerminalView/` (thin shell + `useTerminalView` orchestration), `TerminalTabs/`, `TerminalPane/`,
  `TerminalReadonlyPane/`, `NewTabPicker/`, `terminal-shared.ts` (`TERMINAL_SESSION_CAP = 8`,
  render options, identity copy), `terminal-webgl.ts`. Bridge in `lib/bridge/commands/terminal.ts`
  (dynamic `@tauri-apps/api/core` import inside `isTauri()` branches).
- **Nav**: `AppView` already includes `'terminal'`; `nav.constants.tsx` registers it in the
  `project` group with hint **`L`**; `AppShellViews.tsx` lazy-renders `TerminalView` and threads
  `webglEnabled` (`terminalWebglEnabled`) + `confinedDefault` (`terminalConfinedDefault`).
- **Worktrees**: creation is `worktree::allocate` / `allocate_branch`
  (`worktree/lifecycle.rs`), keyed on a **task id** — dir `<project>/.nightcore/worktrees/<taskId>`,
  branch `nc/<taskId>` (`worktree/path.rs`), enumerated by `list_worktree_task_ids` (reads dir
  names **as task ids**) and **reconciled at startup** (`reconcile` removes any worktree whose id
  is not a live task). The branch picker is `components/ui/BranchPicker/`. The cleanup interlock
  already calls `terminalSessionsInDir(wt.path)` in `WorktreeView/WorktreeView.hooks.ts`.
- **Settings**: `store/settings/model.rs` holds `sandbox_sessions`, `terminal_webgl_enabled`,
  `terminal_confined_default` — the exact serde-additive `#[serde(default)]` idiom every new flag
  below follows.

**⚠️ Four shipped-code facts that shape the PRs below — read § 10 for the full flags:** (1)
`@dnd-kit/sortable` is **NOT installed** (only `@dnd-kit/core` + `/utilities`); (2)
`build_command` currently scrubs **nothing** (inherits Nightcore's full parent env); (3) worktree
creation is **task-scoped and startup-reconciled against the TaskStore** (a synthetic-id worktree
would be garbage-collected on relaunch); (4) the cap constant lives in **two** places (Rust +
web).

---

## 3. PR slicing (locked — ~6 PRs, each independently green)

Order is the build order. PRs 1–5 are additive; PR 6 is structural and last.

### PR 1 — quick wins: manual rename + cap 12 + activity badges

**Scope:** the three lowest-risk, highest-value items, all additive.

**1a. Manual rename (decision 5).**
- **Rust:** add `title: Option<String>` to `TerminalSessionInfo` (`types.rs`) and to the live
  `PtySession` (a `Mutex<Option<String>>` or a plain field behind the registry's `Mutex`), plus a
  `title` field on `PersistedScrollback` (`persist.rs`, `#[serde(default)]` — additive, no `v`
  bump). New command **`terminal_set_title(id, title)`** (async + `spawn_blocking`, USER-only) that
  updates the live descriptor **and** is threaded into the coalescer's `PersistCtx` so the next
  scrollback flush persists it. On restore, the title comes back from the persisted record.
  `None`/empty title ⇒ the web falls back to the cwd leaf (`terminalLabel`), so old sessions render
  identically.
- **Web:** inline-edit on **double-click** of a tab label (`TerminalTabs`) and the pane's identity
  header (`TerminalPane`) — controlled input, **Enter save / Esc cancel / blur save**, auto-width.
  Bridge wrapper `setTerminalTitle(id, title)`. Optimistic local update + `terminal_set_title`.
  `terminal-shared.ts` gains a `displayTitle(session)` helper (`session.title ?? terminalLabel(cwd)`).

**1b. Session cap 8 → 12 (decision 7, first half).**
- **Rust:** `MAX_LIVE_SESSIONS: usize = 12` (`registry.rs`); update the cap-enforcement test's
  expectation and the error-message assertion. The test already uses `with_cap` for a small cap, so
  the real-shell spawn count in tests is unaffected.
- **Web:** `TERMINAL_SESSION_CAP = 12` (`terminal-shared.ts`) — **both constants must move together**
  (trap § 9f). Update `atSessionCap` / picker-disable stories.

**1c. Unread-output activity badge (decision 6c).**
- The badge counts **raw output bytes/batches** arriving for a session that is **not currently
  visible** — **generic, never Claude-output regex** (rejected as brittle).
- **Session manager (`terminal-session-manager.ts`):** the `openSession` Channel callback
  (`(bytes) => term.write(bytes)`) is the one place every output batch lands. Extend `CachedSession`
  with an `unread: number` counter and an **activity subscription** (a tiny module-level
  `Set<listener>` + `notifyActivity(id)`), incremented in the callback **only when the id is not the
  active/visible id**. Expose `getUnread(id)`, `clearUnread(id)`, and `subscribeActivity(fn)`.
- **`useTerminalView`:** subscribe on mount; `clearUnread(activeId)` whenever the active tab changes
  or the window regains focus; derive a per-tab badge count into the tabs/grid render. In grid mode
  (PR 2) the "visible" set is every mounted pane, so only zoomed-away / off-screen panes badge.
- The session manager is module-level (not React); the subscription bridges it to the hook — do not
  try to hold the counter in React state inside the manager.

**Gate battery (PR 1):** `bun run lint && bun run lint:meta`; `bun run --filter @nightcore/web
typecheck && … test`; `cargo fmt --all --check` + `cargo test` **from `apps/desktop/src-tauri`**
(regenerates `TerminalSessionInfo.ts` — commit it); `bun run dogfood:ui` (rename a tab, hit the cap
at 12, badge an inactive tab).

---

### PR 2 — grid: tabs⇄grid toggle, auto-layout, DnD reorder, zoom, persistence

**Scope:** a second **view mode** for the existing tab set — no Rust changes except the persisted
layout blob (below).

**2a. View-mode toggle + count-driven auto-layout (decision 1).**
- A header control toggles `viewMode: 'tabs' | 'grid'`. Grid renders **every live session's pane at
  once** as a **flat CSS grid of siblings keyed by `session.id`** — crucially flat, so React never
  re-parents a pane during reorder/relayout (re-parenting would unmount the xterm host; our session
  manager keeps the instance alive but the DOM host must not be torn between parents mid-drag).
- **Auto-layout by count** (columns; rows follow): 1→1×1, 2→1×2, ≤4→2×2, ≤6→2×3, ≤9→3×3, else 3×4
  (covers the 12 cap). Pure `gridColumns(n)` helper in `terminal-shared.ts`, unit-tested. No
  free-form spans in v1.
- Each grid pane reuses `attachSession(id, hostEl)` — the manager moves the persistent host into the
  pane; a `ResizeObserver`-driven `fit()` already lives in `attachSession`, so every pane resizes its
  PTY independently.

**2b. DnD reorder (decision 1).** ⚠️ **`@dnd-kit/sortable` is NOT a dependency** (§ 10 flag 1). Two
sanctioned paths — pick one in the PR and state it:
  - **(recommended) Build reorder on the installed `@dnd-kit/core`** (`useDraggable` + `useDroppable`
    + `DndContext` + `DragOverlay`, exactly the board's `BoardDnd` idiom) plus a local `arrayMove`.
    A grip handle in each pane header (opacity-0 until hover), an ~8px pointer activation distance,
    and — for keyboard reorder — `@dnd-kit/core`'s `KeyboardSensor`. This adds **no new dependency**.
  - **(alternative) Add `@dnd-kit/sortable`** (a new dep, pinned) for `SortableContext` +
    `rectSortingStrategy`. Only if the core-primitive path proves fiddly. Adding a dep triggers the
    lockfile / client-bundle review; call it out in the PR body.
  - After a drop, force a `fit()` + `xterm.refresh(0, rows-1)` on every pane on the next frame: a
    grid cell that transiently collapses to 0px during the drag leaves a blank canvas that `fit()`
    alone (seeing "no dimension change") won't repaint.

**2c. Zoom one pane (decision 1).** A header **Maximize/Minimize** button + **Cmd/Ctrl+Shift+E**
toggles a `zoomedId`. The zoomed pane replaces the grid; **other panes stay mounted in the manager**
(their xterm keeps buffering — the activity badge counts them while zoomed away). On zoom in/out,
re-`fit()` the newly-sized pane after the transition (a transitionend/RAF settle, matching
`attachSession`'s existing debounce).

**2d. Layout persistence (decision 1, additive).** Persist **view mode + pane order + zoomed id**.
Keep this **web-side** (a `localStorage` blob keyed `nc:terminal:layout` — the layout is a UI
preference, not session state, so it need not round-trip Rust). Order is applied by sorting the live
session list by the persisted id order on mount; unknown ids (new sessions) append; missing ids drop.
Do **not** overload `PersistedScrollback` with layout — that record is per-session scrollback, not a
view model.

**Gate battery (PR 2):** full web gates (folder-per-component on any new `TerminalGrid/`
component); `dogfood:ui` (toggle to grid, drag two panes, zoom + ⌘⇧E, reload → layout restored).
No Rust change ⇒ `cargo test` only if a shared type moved (it shouldn't).

---

### PR 3 — ergonomics: shortcuts, clipboard smarts, search + web-links, font/scrollback settings

**3a. Shortcuts (decision 6a).** **⌘T** new terminal (open picker), **⌘W** close active (confirm
per the existing `ConfirmDialog`), **⌘⇧E** zoom (PR 2). Register at the Terminal-view scope, not
globally, and **only while the Terminal view is active**. Render Kbd hints in the tab-bar "+" and the
close/zoom buttons.
  - ⚠️ **⌘W collides with the WKWebView "close window" default** (§ 10 flag 5). The handler MUST
    `preventDefault()` and only act when a terminal tab is active; verify in `dogfood:ui` that ⌘W
    does not close the app window.
  - ⚠️ Nav single-letter shortcuts (`useNavShortcuts`) are **bare keys guarded by `isTypingTarget`**,
    which already returns true for xterm's hidden helper `<textarea>` — so **typing in the terminal
    never triggers nav** (typing `w` won't jump to Worktrees). The cockpit shortcuts use **modifiers**
    (⌘/⌃), which `useNavShortcuts` explicitly ignores — no collision. Preserve both properties.

**3b. Clipboard / copy-paste smarts (decision 6b).** Wire via xterm's
`attachCustomKeyEventHandler` on each live term (in `attachSession` or a small `installKeymap(term)`):
  - **Smart ⌘/⌃C:** if `term.getSelection()` is non-empty → copy it (`navigator.clipboard.writeText`
    — WKWebView supports it; **no Tauri clipboard plugin is in the tree**, § 10 flag 6) and swallow
    the key; else fall through so the shell receives **SIGINT** (`\x03`).
  - **Paste:** platform paste keys (⌘V on macOS; Ctrl+V / Ctrl+Shift+V on Win/Linux) →
    `navigator.clipboard.readText()` → cap at **1 MB** (drop + toast beyond) → write to the PTY
    wrapped in **bracketed paste** when the program enabled it (see § 4 bracketed-paste note; xterm's
    own paste already brackets when `?2004h` is set, so preferring `term.paste(text)` gets this for
    free).
  - **Shift+Enter → `ESC` + `\n`** (`\x1b\n`): multiline input in a TUI without submitting.
  - **⌘/⌃Backspace → `Ctrl+U`** (`\x15`): kill line.
  - Keep passthrough for app chords (⌘T/⌘W/⌘⇧E handled at 3a; ⌘1..9 etc.).

**3c. Search + web-links addons (decision 6d).** ⚠️ **Version-lock to xterm 6** (§ 9 traps): the tree
has `@xterm/xterm@6.0.0`, `@xterm/addon-fit@0.11.0`, `@xterm/addon-webgl@0.19.0`. The 6.0-compatible
search / web-links addons are **`@xterm/addon-search@0.16.0`** and **`@xterm/addon-web-links@0.12.0`**
(current `latest`; do NOT pull the `0.17`/`0.13` betas). Add both to `apps/web/package.json`, pinned.
  - **Search:** load `SearchAddon` per live term; a small in-pane search bar (⌘F to open, Enter /
    Shift+Enter for next/prev, Esc to close) calling `findNext` / `findPrevious`.
  - **Web-links:** load `WebLinksAddon` with a handler that opens the URL via the Tauri opener.
    ⚠️ The shipped `open_external` command is **https-only** (`workflow/pr/open.rs` validates
    `https`) — a terminal URL may be `http`/`file`. Either **restrict the link handler to
    `https?://`** and hand https to `openExternal` (simplest, recommended), or extend the opener to
    accept `http`. Do **not** widen it to arbitrary schemes.

**3d. Font size + scrollback settings (decision 6e — slim).** Two new global settings, serde-additive
(`store/settings/model.rs`, mirroring `terminal_webgl_enabled`):
  - `terminal_font_size: Option<u16>` (`#[serde(default)]`, `None` ⇒ the shipped 13px), and
  - `terminal_scrollback: Option<u32>` (`#[serde(default)]`, `None` ⇒ the shipped ~10k).
  Plus the `SettingsPatch` `Option<>` twins + `Default` + merge lines. **Reactive apply:** a session-
  manager `applyRenderPrefs({ fontSize, scrollback })` walks every live `CachedSession`, sets
  `term.options.fontSize` / `term.options.scrollback`, and `fit()`s — **no reopen** (xterm applies
  option changes live). Thread the two values from `AppShellViews` into `TerminalView` beside
  `webglEnabled`. Font/scrollback are **web render prefs**; the Rust ring stays ~10k regardless (the
  web scrollback is xterm's own buffer — the § 10-noted "web-side scrollback source").

**Gate battery (PR 3):** web gates + **`cargo test` from src-tauri** (new Settings fields regenerate
`Settings.ts`); `dogfood:ui` (⌘T/⌘W/⌘⇧E; select-then-⌘C copies, empty-selection ⌘C sends SIGINT;
paste a >1MB blob is capped; ⌘F search; click a URL opens the browser; change font size live).

---

### PR 4 — task integration: dropdown + injection + linkage chip + claude launch/resume + env hygiene + ungoverned marker + YOLO setting

**4a. Env hygiene at spawn (decision 3) — Rust, do this FIRST in the PR.** ⚠️ `build_command`
(`session.rs`) currently sets only `TERM`/`COLORTERM` and **inherits Nightcore's entire parent env**
(portable-pty's `CommandBuilder` inherits unless cleared) — so a terminal launched from a
Claude-spawned Nightcore inherits `CLAUDECODE`, and any `ANTHROPIC_API_KEY` / provider vars leak in
(§ 10 flag 2). Add, for **every** spawn (confined and not):
```
for key in ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "ANTHROPIC_API_KEY",
            "ANTHROPIC_AUTH_TOKEN", "NIGHTCORE_PROVIDER", /* provider-env vars */] {
    cmd.env_remove(key);
}
```
Rationale (stated as a Nightcore decision): stripping `CLAUDECODE` lets a `claude` launched **inside**
the terminal start cleanly instead of tripping its own nested-session guard; stripping
`ANTHROPIC_API_KEY` keeps the launch on the user's OAuth/subscription path rather than silently
billing an API key. Keep the exact provider-var list in one const beside `build_command`; unit-test
that the resulting `CommandBuilder` has these removed (pure, no PTY — clone the existing
`build_command` env test).

**4b. Task dropdown + context injection (decision 2).** A header dropdown lists the active project's
**backlog tasks** (top N by recency) read from the existing task bridge (`listTasks`-equivalent — the
tasks live at `.nightcore/tasks/<id>.json`; the web already has a task list source). Selecting a task:
  1. **Composes** the injection text: the task **title**, a blank line, the **description**, a blank
     line, and the line `Task file: <projectPath>/.nightcore/tasks/<id>.json` (the exact on-disk path
     — verified convention `store/registry.rs` / `store/mod.rs`).
  2. **Frames it in bracketed paste**: `ESC[200~` + text + `ESC[201~`, **no trailing newline**
     (decision 2 — the user presses Enter). Write via **`terminal_write`** (raw `Vec<u8>`; the seam
     forwards bytes verbatim — no line-splitting, so bracketed paste survives, § 4).
  3. **Links** the task to the terminal (web-side link map + the linked terminal **auto-takes the task
     title** via `terminal_set_title` from PR 1) and marks the terminal **ungoverned** (4d).
- **Task card chip:** the board `TaskCard` shows a small **terminal chip** when a live terminal is
  linked to that task id (click → route to Terminal view + activate that tab). The link map is
  web-side state (a `Map<taskId, sessionId>`), seeded from the active sessions; it is **not**
  persisted to the task file (a task's status/gates must not depend on a terminal).

**4c. `claude` launch + resume affordances (decision 3).** A one-click **"Launch Claude"** button on a
live tab types a composed command into the PTY (via `terminal_write`, ending with `\r` so it runs):
`cd <shell-escaped cwd> && claude` (+ `--dangerously-skip-permissions` iff YOLO is on, 4e). A
**restored / read-only tab** gets a **"Resume"** affordance that, on "start a fresh shell here"
(existing flow), composes `cd <cwd> && claude --continue` — `--continue` resumes the most-recent
session in that cwd (no fragile `--resume <id>`). Shell-escape the cwd; join with `&&` (POSIX) — a
Windows PowerShell path would use `;`, but the composed-launch button is gated to POSIX shells in v1
(state this; the terminal already resolves the shell family in `shell.rs`).

**4d. Ungoverned marker (decision 3).** Any task-linked or Claude-launched terminal renders an
**"ungoverned session"** badge in the tab + pane identity chrome, tooltip: *"Runs as you, outside the
gates, flight-recorder, and gauntlet. Terminal work can never mark a task verified."* This reuses the
existing identity-chrome slot in `TerminalTabs`/`TerminalPane`; copy lives in `terminal-shared.ts`.

**4e. YOLO setting (decision 3).** A new global flag `terminal_yolo_launch: bool`
(`#[serde(default)]`, **default false**, `store/settings/model.rs`; patch twin + default + merge).
Surfaced in Settings as an **explicitly warning-labelled** toggle (*"Adds
`--dangerously-skip-permissions` to the Launch-Claude command — the agent runs with no permission
prompts. Off by default."*). When on, 4c's composed command appends the flag. It changes **only the
composed launch string**, nothing about the PTY seam or confinement.

**Gate battery (PR 4):** web gates + **`cargo test` from src-tauri** (env-strip unit test; new
`terminal_yolo_launch` regenerates `Settings.ts`; `terminal_set_title` return/desc types if exported);
`dogfood:engine` (real sidecar/scratch repo: pick a task → the composed prompt appears **unexecuted**
in a real shell, multiline intact, awaiting Enter; Launch Claude starts `claude` with no
`CLAUDECODE`/`ANTHROPIC_API_KEY` leak; YOLO off by default; task card shows the chip).

---

### PR 5 — worktrees: create-in-picker + open-terminal-here + cleanup-interlock extension

**5a. Create-new-worktree path in the new-tab picker (decision 4).** The picker gains a **"Create new
worktree…"** entry → a small dialog: **name** (live-sanitized to a slug), a **"create branch" toggle**,
and a **base-branch picker** reusing `components/ui/BranchPicker/` + `listBranches()`. **No
dep-symlink, no auto-push** (decision 4). On confirm, a **new command** creates the worktree and the
picker spawns a terminal in the returned path.

⚠️ **The worktree machinery is task-scoped and startup-reconciled** (§ 10 flag 3): `allocate_branch`
takes a `task_id`, the dir is `.nightcore/worktrees/<taskId>`, the branch is `nc/<taskId>`, and
`reconcile` **deletes at startup any worktree whose dir-name id is not a live task**. A naive
"synthetic task id" worktree would therefore be **garbage-collected on the next relaunch.** Sanctioned
design (state the choice in the PR):
  - Add **`terminal_create_worktree(name, createBranch, base) -> WorktreeInfo`** in
    `commands/worktree.rs`, implemented over a new `worktree::allocate_terminal(project, slug, branch,
    base)` that places the worktree under a **distinct base** `.nightcore/worktrees-term/<slug>` (or a
    `term/` prefix) with branch `term/<slug>` — **outside** the `nc/<taskId>` namespace that
    `reconcile` sweeps — so it is **never reconciled away**. Reuse the exact `git worktree add` /
    `validate_ref` / retry logic of `allocate_branch`; only the base dir + branch prefix differ.
  - The terminal-created worktree must still be **discoverable by the cleanup interlock** (5c) and,
    ideally, the Worktrees view — but must **not** masquerade as a task worktree in the board monitor
    (`list_worktree_task_ids` reads dir names as task ids; keep the terminal base separate so it does
    not pollute that list). Recommendation: enumerate terminal worktrees separately (their own
    lister) and surface them in the Worktrees manager under a "Terminal worktrees" group.
  - Validate + slug the name server-side (`validate_ref` on the derived branch); the webview value is
    never trusted (mirror `allocate_branch`'s injection defense).

**5b. "Open terminal here" on task worktrees (decision 4).** The Worktrees view / task-worktree row
gains an action that routes to the Terminal view and spawns a session with `cwd = wt.path` (the
existing `spawnInto` path). Pure web wiring over commands that already exist.

**5c. Cleanup-interlock extension (decision 4).** The interlock already gates merge/discard on
`terminalSessionsInDir(wt.path)` (`WorktreeView.hooks.ts`). Because it keys on **path**, terminal-
created worktrees (5a) are covered **for free** once they appear in the worktree list; verify the
discard path for a terminal-base worktree also calls the interlock (it goes through the same
`is_under`-guarded remove — confirm the terminal base is inside `.nightcore/` so the guard permits
removal). Add a test that a discard with a live terminal in a terminal-created worktree surfaces the
"N sessions open" confirm.

**Gate battery (PR 5):** web gates + **`cargo test` from src-tauri** (new command + `allocate_terminal`
lifecycle tests: create off default/custom base, branch toggle, re-create idempotence, **NOT swept by
reconcile**, discard-under-base guard); `dogfood:engine` (create a worktree from the picker → terminal
opens there → relaunch → **worktree survives** → discard with the terminal open → confirm gate fires).

---

### PR 6 — live-PTY survival across app restarts (the detached daemon) — ships LAST, own PR

See § 5 for the full mini-design + risk register. Everything in PRs 1–5 must be green **without** this
PR; PR 6 is a pure capability add behind a feature that degrades to today's read-only restore.

---

## 4. Cross-cutting mechanic: bracketed-paste injection (decisions 2, 6b)

Injection and paste both rely on **bracketed paste**: wrap the payload in `ESC[200~` (`\x1b[200~`)
and `ESC[201~` (`\x1b[201~`). A program that has enabled bracketed-paste mode (sent `ESC[?2004h`)
treats everything between the markers as **literal input** — embedded newlines do **not** submit
line-by-line, which is the whole point of decision 2 (a multiline task prompt can't accidentally
execute in a bare shell).

- **`terminal_write` is safe for this** (verified): it forwards raw `data: Vec<u8>` straight to
  `writer.write_all` with no line-splitting or transformation. No shipped constraint breaks bracketed
  paste. (§ 10 flag 4 confirms this is a *non-issue*.)
- **Dependency:** the receiving program must have enabled `?2004h`. Interactive `zsh` (ZLE), `bash`
  4.4+ (readline), and the `claude` TUI all enable it. A **raw non-interactive `sh`** at a prompt that
  hasn't enabled it would show the `[200~`/`[201~` markers literally. Acceptance: injection targets an
  interactive prompt or the `claude` TUI; document that a bare `sh` is out of the happy path. For 6b
  paste, preferring xterm's own `term.paste(text)` inherits xterm's correct "bracket only if the app
  turned it on" behavior automatically.
- **No trailing newline on injection** (decision 2) — the user presses Enter. **Trailing `\r` IS added
  on the composed `claude` launch command** (4c) — that one is meant to execute immediately.

---

## 5. PR 6 mini-design: detached PTY daemon (live-PTY survival)

**Goal:** the human's shells keep running when the app window closes/relaunches; on relaunch the app
**reattaches** to the live PTYs and replays their buffered output, instead of today's read-only
scrollback restore. **Frame honestly:** this is the riskiest item; it ships alone and **degrades
cleanly** to the shipped read-only restore whenever the daemon is absent, dead, or unsupported on the
platform.

### 5.1 Ownership + spawn semantics
- A **separate detached process** (the "PTY daemon") **owns** the PTYs. The Tauri app becomes a
  **client**: `terminal_spawn`/`write`/`resize`/`kill`/`list` proxy to the daemon over IPC instead of
  owning `PtySession`s directly. The daemon reuses the existing `terminal/session.rs` machinery
  (reader/coalescer/ring) — it is the same code, hosted in a process that outlives the window.
- **Detach per platform:**
  - **Unix (macOS/Linux):** `setsid()` (new session, no controlling terminal) + close/redirect
    std fds, so closing the app doesn't `SIGHUP` the daemon or its children. Spawn via a small
    launcher (the app's own binary with a `--pty-daemon` arg, or a sibling binary).
  - **Windows:** `CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS` (no inherited console) so the daemon
    survives the app and ConPTY children aren't torn down with the app's console.
- **Single daemon per user/project scope**, discovered via a well-known path (5.3). If none is
  running, the app **starts one**; if one is running, the app **attaches**.

### 5.2 IPC protocol sketch
- **Transport:** a **local socket** — Unix domain socket on macOS/Linux (`.nightcore/…/pty.sock` or an
  XDG runtime path), a **named pipe** on Windows (`\\.\pipe\nightcore-pty-<hash>`).
- **Auth via filesystem permissions:** the socket/pipe path lives in a **0700 owner-only** directory;
  a Unix socket gets 0600. No network, no token — the OS permission boundary is the auth (only the
  same user can connect). State this as the security model; the daemon **refuses** connections it
  can't attribute to the owning uid where the platform allows peer-cred checks (`SO_PEERCRED` /
  `LOCAL_PEERCRED`).
- **Messages** (length-prefixed frames; control channel JSON, output channel binary — mirroring the
  in-app `ipc::Channel` Raw discipline): `hello{version}` → `helloAck{version, sessions[]}`;
  `create{cwd, confined, cols, rows}` → `created{id, info}`; `write{id, bytes}`; `resize{id, cols,
  rows}`; `kill{id}`; `list` → `sessions[]`; `subscribe{id, sinceSeq}` → a stream of
  `output{id, seq, bytes}`; `ping`/`pong`. **Version-negotiate** on `hello` (an older app vs a newer
  daemon, or vice-versa, must degrade, not corrupt).
- **The web still consumes a per-session binary `Channel`** — the Tauri command layer bridges the
  daemon's `output` frames onto the same `InvokeResponseBody::Raw` sink the shipped code already uses,
  so **nothing web-side changes** (the session manager, tabs, grid all keep working).

### 5.3 Reattach + buffered-output replay
- The daemon keeps a **bounded ring per session** (the existing `ScrollbackRing`, plus a small
  **replay tail** with sequence numbers). On relaunch the app `hello`s, gets the live `sessions[]`,
  and for each calls `subscribe{sinceSeq}`; the daemon **replays** the buffered tail (ANSI-preserving
  bytes) then streams live output. The web renders replayed bytes into the (fresh) xterm exactly like
  a normal stream — no separate "read-only" mode for a **live** reattached session.
- **Sequence numbers** dedupe the replay/live boundary (don't double-write the tail). Bound the replay
  tail (e.g. the ring's ~10k lines) so reattach is cheap.

### 5.4 Orphan / crash handling (degrade, never brick)
- **Daemon dead / socket stale:** the app cleans the stale socket and **falls back to today's
  read-only scrollback restore** (`terminal_list_persisted` / `terminal_read_persisted`) — the shipped
  path is the fallback, so a broken daemon never blocks the terminal.
- **App crash, daemon alive:** on relaunch the app reattaches (5.3); orphaned sessions the user no
  longer wants are killable from the restore list.
- **Daemon idle with zero sessions:** self-exit after a grace period so it doesn't linger forever.
- **Version skew:** on `hello` mismatch the app either speaks the daemon's older protocol or, if it
  can't, treats the daemon as unavailable and falls back to read-only restore (never corrupt a live
  session by guessing).
- The daemon **still persists scrollback to `.nightcore/terminals/<id>.json`** on the existing cadence,
  so even a hard daemon kill leaves the shipped read-only restore intact.

### 5.5 Confined (Seatbelt) sessions + the daemon — **decision: daemon-EXEMPT**
Confined tabs are macOS Seatbelt-wrapped, **fail-closed**, and scoped to a cwd. **v1 decision:
confined sessions are NOT daemon-owned — they die with the app** (the app spawns them in-process as
today; only unconfined sessions are eligible for daemon ownership + survival). Rationale: a
survived-across-restart Seatbelt shell reattaching to a new app process complicates the containment
story (profile lifetime, re-exec, the per-session scratch state dir) with no strong user demand.
State it in the identity chrome: a confined tab shows it will **not** survive a restart (it read-only-
restores like today). Revisit only if users ask.

### 5.6 v1 daemon scope — platform asymmetry (implementer decision + recommendation)
Unix `setsid` detach + Unix-socket IPC is markedly simpler and more battle-tested than Windows
`DETACHED_PROCESS` + named-pipe + ConPTY-survival. **If platform asymmetry forces a cut,
macOS/Linux-first with Windows falling back to today's read-only restore is acceptable** — and is the
**recommended** v1 shape: ship the daemon on Unix, keep Windows on the shipped read-only-restore path
behind the same capability check, and close the Windows gap in a follow-up. The web is identical
either way (both terminate in the same binary `Channel` sink); the only difference is whether a given
platform's relaunch reattaches (Unix) or read-only-restores (Windows v1).

### 5.7 Risk register (PR 6)
| Risk | Mitigation |
|---|---|
| Orphaned daemon leaks processes / never dies | Idle-with-zero-sessions self-exit; a "kill all terminals" affordance; the daemon is a child of a launcher, not the window. |
| Stale socket after an unclean exit | Liveness `ping` on connect; unlink + respawn on no-pong; PID/lock file. |
| Protocol version skew (app updated, daemon old, or vice-versa) | `hello` version negotiation; on unbridgeable skew, treat as unavailable → read-only-restore fallback. |
| Auth: another local user connecting | 0700 dir + 0600 socket; peer-cred uid check where supported; no network transport ever. |
| Secret-bearing buffers now live in a long-lived process + on disk | Owner-only perms on socket + buffer files; `.nightcore/terminals/` stays export-excluded; daemon holds only the bounded ring, not full history. |
| ConPTY teardown on Windows console close | `DETACHED_PROCESS` (no inherited console); or ship Windows on read-only-restore in v1 (§ 5.6). |
| Reattach double-writes the replay tail | Sequence-numbered `subscribe{sinceSeq}`; dedupe at the boundary. |
| Daemon crash mid-session | Scrollback still flushed to disk on cadence → read-only restore intact; supervise/respawn only for *new* sessions, never silently resurrect a dead shell. |
| USER-ONLY seam widened by a new socket | The socket is owner-only + local + never wired to any engine/sidecar/provider path; the daemon speaks only to the app's command layer. Re-assert in the daemon's module doc. |

---

## 6. Contract / persistence evolution (serde-additive, all PRs)

| Change | File | PR | Note |
|---|---|---|---|
| `title: Option<String>` on live descriptor | `terminal/types.rs` `TerminalSessionInfo` | 1 | ts-rs regen on `cargo test`; `None` ⇒ web cwd-leaf fallback. |
| `title` on persisted record | `terminal/persist.rs` `PersistedScrollback` | 1 | `#[serde(default)]`, **no `v` bump** (additive); old files load with `title=""`. |
| `terminal_set_title` command | `commands/terminal.rs` | 1 | async + `spawn_blocking`; USER-only; registered in `lib.rs generate_handler!`. |
| Cap constant 8→12 (×2) | `terminal/registry.rs` + `terminal-shared.ts` | 1 | **both** or the client-side disable drifts from the server guard. |
| `terminal_font_size: Option<u16>`, `terminal_scrollback: Option<u32>` | `store/settings/model.rs` (+ `patch.rs`, `Default`, merge) | 3 | mirror `terminal_webgl_enabled`; regen `Settings.ts`. |
| `@xterm/addon-search@0.16.0`, `@xterm/addon-web-links@0.12.0` | `apps/web/package.json` | 3 | **xterm-6-compatible pins**; not the 0.17/0.13 betas. |
| Env-strip list | `terminal/session.rs` `build_command` | 4 | `env_remove` CLAUDECODE / ANTHROPIC_API_KEY / provider vars for every spawn. |
| `terminal_yolo_launch: bool` | `store/settings/model.rs` (+patch/default/merge) | 4 | `#[serde(default)]`, **default false**; regen `Settings.ts`. |
| `terminal_create_worktree` command + `worktree::allocate_terminal` | `commands/worktree.rs`, `worktree/lifecycle.rs` | 5 | distinct base outside the `nc/<taskId>` reconcile namespace; returns `WorktreeInfo`. |
| Daemon protocol + client | new `terminal/daemon*` | 6 | control-JSON + binary-output frames; version-negotiated; degrades to read-only restore. |

**No new event-system (`nc:*`) channels are expected.** Terminal traffic rides the binary
`ipc::Channel`, never the event system (predecessor hard rule). If an implementer finds an
event-system need, that is a **spec deviation to flag, not silently add**.

---

## 7. Codegen / lint lockstep checklist

| Concern | File | PR | Action |
|---|---|---|---|
| ts-rs export of `TerminalSessionInfo` (new `title`) | `terminal/types.rs` (+ `bindings/export.rs` if not already listed) | 1 | `cargo test` from `src-tauri` regenerates `apps/web/src/lib/generated/TerminalSessionInfo.ts`; **commit** it. Never hand-edit. |
| ts-rs export of `Settings` (new fields) | `store/settings/model.rs` | 3,4 | `cargo test` regenerates `Settings.ts`; commit. |
| New commands registered | `lib.rs` `generate_handler!` | 1,4,5 | `terminal_set_title`, `terminal_create_worktree`; a command absent from `generate_handler!` is invisible at runtime. |
| Web folder-per-component | `packages/eslint-plugin/` | 1–5 | Any new component folder (e.g. `TerminalGrid/`, a rename input, a task dropdown, a create-worktree dialog) satisfies `component-folder-structure` / thin-shell / hook-budget / ≤400-line ratchet; `no-cross-feature-imports` (terminal lives under `components/terminal/`). Validate `bun run lint`. |
| No new `nightcore/*` ESLint rule | `tools/lint-meta/`, `agent-contract-parity` | — | **Add none** (the AGENTS.md-parity trap): `bun run lint` fails if a wired `nightcore/*` rule isn't named in some `AGENTS.md`. None is needed here. Validate `bun run lint:meta` = zero on a clean tree. |
| New web dep(s) | `apps/web/package.json` + lockfile | 3 (+2 if sortable) | Commit the lockfile delta; the client-bundle reviewer flags heavy adds — the xterm addons are tiny; `@dnd-kit/sortable` (if chosen) is small. |

---

## 8. Verification gate battery (run per PR, from the repo root unless noted)

```
bun run lint && bun run lint:meta                 # eslint-plugin (folder-per-component) + parity/codegen-drift
bun run --filter @nightcore/web typecheck         # root `tsc -b` does NOT typecheck apps/web
bun run --filter @nightcore/web test              # web unit/story tests
cargo fmt --all --check                           # MUST run from apps/desktop/src-tauri (root has no Cargo.toml → silent no-op)
cargo test                                        # from apps/desktop/src-tauri; regenerates + must-commit ts-rs (TerminalSessionInfo/Settings)
bun run dogfood:ui                                # PR 1–3 manual: rename, cap 12, badges, grid+DnD+zoom, shortcuts, copy/paste, search, links, font
bun run dogfood:engine                            # PR 4–6 manual: task injection (unexecuted, multiline), claude launch/env-strip, worktree create+survive, daemon reattach
```

Per-PR emphasis:
- **PR 1 / 3 / 4** run `cargo test` for real ts-rs regen (descriptor `title`, Settings fields) —
  commit `apps/web/src/lib/generated/*` and `bindings/*`; never hand-edit.
- **PR 4** must verify env hygiene in a **real** shell (`dogfood:engine`) — the leak only manifests
  when Nightcore itself was launched with `CLAUDECODE`/`ANTHROPIC_API_KEY` in its env.
- **PR 5** must verify **worktree survival across a relaunch** (the reconcile-namespace trap) —
  headless lifecycle tests + one `dogfood:engine` relaunch.
- **PR 6** exercises detach/reattach on macOS + Linux (and, if in scope, Windows) and the
  daemon-dead → read-only-restore fallback.
- **`cargo clippy --all-targets` (from src-tauri) MUST be green on Linux** for any platform-uneven
  code (trap § 9c) — trust CI's `rust-checks` Linux job or run it before declaring a Rust PR done.

---

## 9. Traps (mandatory — repo canon + terminal-specific; each has bitten this codebase or is provable here)

**Repo canon**

**(a) Worktree bootstrap order.** A fresh worktree needs `bun install` (inherited `node_modules`
symlinks point at MAIN's packages), then codegen is two-way: `bun run --filter @nightcore/sidecar
compile` before any desktop `cargo` build (the sidecar is an `externalBin`), and contract types
generate BOTH ways (zod→Rust `generated.rs`; Rust→TS `apps/web/src/lib/generated/` via ts-rs on
`cargo test`). Root `tsc -b` does **not** typecheck `apps/web` — use `--filter @nightcore/web
typecheck`.

**(b) `cargo fmt`/`test` run from `apps/desktop/src-tauri`.** The repo root has no `Cargo.toml`;
`cargo fmt --all` / `cargo test` from root **silently no-op**. Always `cd apps/desktop/src-tauri`.

**(c) `#[cfg_attr(not(target_os = "macos"), allow(dead_code))]` for platform-uneven code.** CI's
`rust-checks` job runs Linux `clippy -D warnings`; a macOS-only fn (confinement helpers, any
daemon `setsid` path) is "never constructed" on Linux and reds the gate. Annotate exactly where it
bites (see `confine.rs` / `shell.rs` `ShellCandidate` for the established pattern). Build MUST be
green on all three OSes.

**(d) ts-rs is regenerate-and-diff.** New/changed contract fields export only during `cargo test`
run from `src-tauri`; register in `bindings/export.rs` if not already, run `cargo test`, and
**commit** the regenerated `apps/web/src/lib/generated/*` + `bindings/*`. A missing regen reds the CI
drift guard.

**(e) serde-additive persistence.** New fields on `PersistedScrollback` / `TerminalSessionInfo` /
`Settings` MUST be `#[serde(default)]` (or `Option<>`) so a file/descriptor written before the field
loads cleanly. Every prior field upholds this; the `PersistedScrollback` `v:1` + all-`#[serde(default)]`
test (`old_schema_without_version_field_still_loads`) is the pattern — a `title` add needs **no** `v`
bump.

**(f) Dynamic Tauri imports in web code touched by tests.** `lib/bridge/commands/terminal.ts` imports
`@tauri-apps/api/core` via **dynamic import inside `isTauri()` branches**, never top-level — that kept
the vitest browser dep-optimizer from re-bundling mid-run and 404-ing in-flight module URLs. Any new
bridge wrapper (`setTerminalTitle`, `terminalCreateWorktree`) follows the same shape; outside the
webview it degrades to the mock/echo.

**(g) Binary `ipc::Channel` Raw semantics.** Output is `InvokeResponseBody::Raw(Vec<u8>)` on a
per-session `Channel`, surfaced to the web as an `ArrayBuffer` → `Uint8Array` for `term.write()` —
**never JSON, never base64** on the hot path (base64 is only the persisted-scrollback replay field).
The daemon (PR 6) must bridge its output frames onto this same Raw sink so nothing web-side changes.

**(h) folder-per-component + eslint plugin gates.** Every new component is a `Name/` folder
(`Name.tsx` thin shell + `.hooks.ts` + `.types.ts` + `.stories.tsx` + `.test.tsx` + `index.ts`),
≤400 lines, no state in the body, no cross-feature imports. `bun run lint` (the `@nightcore/eslint-
plugin`) catches these; typecheck/tests don't.

**(i) PR labels mandatory at open.** Every PR needs a **`type:`** label and one or more **`area:`**
labels at open time (repo convention). Terminal PRs: `type: feature`, `area: terminal` (+ `area:
worktree` for PR 5, `area: settings` for PRs 3/4, `area: rust`/`area: web` as applicable).

**Terminal-specific**

**(j) `@dnd-kit/sortable` is NOT installed.** Only `@dnd-kit/core` + `@dnd-kit/utilities` are deps;
the board reorders with `@dnd-kit/core` primitives (`useDraggable`/`useDroppable`/`DragOverlay`/
`closestCorners`), **not** `SortableContext`/`rectSortingStrategy`. PR 2 either builds reorder on the
core primitives (recommended, no new dep) or adds `@dnd-kit/sortable` explicitly (§ 3 PR 2b).

**(k) xterm addon versions are pinned to the xterm-6 line.** Tree: `@xterm/xterm@6.0.0`,
`addon-fit@0.11.0`, `addon-webgl@0.19.0`. The 6-compatible search/web-links addons are
**`addon-search@0.16.0`** and **`addon-web-links@0.12.0`** (`latest`). Do NOT install the `0.17`/`0.13`
**betas** or a 5.x addon — a mismatched addon major throws at `loadAddon` against xterm 6.

**(l) Bracketed-paste framing needs the receiver in `?2004h`.** Injection wraps payloads in
`ESC[200~…ESC[201~`; interactive zsh/bash/claude-TUI enable bracketed paste, a bare non-interactive
`sh` may not (markers show literally). `terminal_write` forwards bytes verbatim (safe); prefer
`term.paste()` for the 6b paste path to inherit xterm's "bracket only if enabled" logic (§ 4).

**(m) `⌘W` collides with the WKWebView close-window default; nav shortcuts are bare letters.** The
cockpit shortcuts use modifiers and must `preventDefault()` (especially `⌘W`, which otherwise closes
the app window). Bare single-letter nav shortcuts (`useNavShortcuts`) are already suppressed while the
xterm helper `<textarea>` has focus (`isTypingTarget` catches `TEXTAREA`), so terminal typing never
navigates — preserve both properties (§ 3 PR 3a).

**(n) The `open_external` command is https-only.** The web-links handler must restrict to `https?://`
and hand https to the shipped opener, or the URL is rejected (`workflow/pr/open.rs` validates https).
Do not widen the opener to arbitrary schemes (§ 3 PR 3c).

**(o) No Tauri clipboard plugin in the tree.** Smart-copy/paste use `navigator.clipboard`
(read/writeText) in the WKWebView — do NOT add a clipboard plugin for v1 (§ 3 PR 3b).

**(p) Env inheritance at spawn.** `portable-pty`'s `CommandBuilder` **inherits** the parent env unless
cleared; the shipped `build_command` only *adds* `TERM`/`COLORTERM`. PR 4 must `env_remove` the
Claude/provider vars for **every** spawn, not just Claude-launched ones (§ 3 PR 4a).

**(q) Worktree creation is task-scoped + startup-reconciled.** `allocate*` key on a task id; `reconcile`
deletes worktrees whose dir-name id isn't a live task. A terminal-created worktree MUST live outside
that namespace (its own base/branch prefix) or it is garbage-collected on the next relaunch
(§ 3 PR 5a).

**(r) ConPTY quirks (Windows).** ConPTY resize is async and its exit is delayed; the shipped Rust path
is synchronous-ish and needs none of the async-IPC resize-mismatch-correction machinery other stacks
carry — do not add it.
For PR 6, ConPTY children die with the app's console unless the daemon is spawned `DETACHED_PROCESS`
(§ 5.1); the honest v1 fallback is Windows-on-read-only-restore (§ 5.6).

---

## 10. Loud flags — shipped code vs the locked decisions

1. **`@dnd-kit/sortable` is not a dependency** (only `@dnd-kit/core` + `/utilities`). Decision 1 says
   "@dnd-kit drag reorder (already a board dependency)" — true for `@dnd-kit/core`, **not** for
   `sortable`. PR 2 must build reorder on core primitives (recommended) or add `sortable` as a new
   pinned dep. **Not a blocker — a build-path choice to state in the PR** (§ 3 PR 2b, trap j).

2. **`build_command` scrubs nothing today** — it inherits Nightcore's full parent env. Decision 3's
   env hygiene is therefore **net-new work in PR 4**, not a tweak: without it, a terminal launched
   from a Claude-spawned Nightcore leaks `CLAUDECODE` (trips the nested-session guard) and any
   `ANTHROPIC_API_KEY` (bills the API path). **Do it first in PR 4** (§ 3 PR 4a, trap p).

3. **Worktree creation is task-scoped and startup-reconciled** (dir `= .nightcore/worktrees/<taskId>`,
   branch `nc/<taskId>`, `reconcile` deletes any worktree whose id is not a live task). Decision 4's
   "create new worktree" cannot reuse `allocate_branch` with a synthetic task id **as-is** — it would
   be **garbage-collected on the next relaunch**. PR 5 must place terminal worktrees in a **separate
   base/branch namespace** outside the reconcile sweep (§ 3 PR 5a, trap q). **This is the biggest
   design constraint in the spec.**

4. **`terminal_write` does NOT break bracketed-paste injection** (verified reassurance): it forwards
   raw `Vec<u8>` via `write_all` with no line-splitting or transformation. Decision 2's
   framing-without-newline works as specified. The only caveat is the receiver must be in `?2004h`
   (interactive shells / claude TUI are) — a documented happy-path assumption, not a blocker (§ 4,
   trap l).

5. **`⌘W` will close the app window** in WKWebView unless the PR 3 handler `preventDefault()`s it —
   the shipped app has no terminal `⌘W`, so this is a new collision to handle, not a regression
   (§ 3 PR 3a, trap m).

6. **The persist model takes a `title` field cleanly** (verified reassurance): `PersistedScrollback`
   is `v:1` with every field `#[serde(default)]` and an explicit "old file without the field loads via
   defaults" test — adding `title` is additive with **no `v` bump**. Likewise `TerminalSessionInfo`
   and `Settings` evolve additively via ts-rs. No blocker (§ 6, trap e).

7. **Minor:** the shipped external opener is **https-only** and there is **no clipboard plugin** — both
   shape PR 3 wiring (restrict web-links to https; use `navigator.clipboard`) but neither blocks
   (traps n, o).

---

## 11. Deferred / out of v1 (named so they are not silently in-scope)

- **AI auto-naming** of tabs (decision 5 — manual rename only). No LLM naming in v1.
- **Claude busy/idle output-regex borders + rate-limit parsing** — explicitly rejected as brittle
  (decision 6c is a **generic** byte-activity badge, not output parsing).
- **Multi-account profiles / env injection, CLI install-version badge, "Invoke Claude All" broadcast,
  file-tree drag-path-into-terminal** — not in the locked scope; out of v1.
- **Free-form grid spans / manual resize** — grid is count-driven only (decision 1).
- **Daemon-owned confined sessions** — confined tabs die with the app in v1 (§ 5.5); read-only-restore
  as today.
- **Windows live-PTY survival** — acceptable v1 cut: macOS/Linux daemon, Windows on read-only-restore
  (§ 5.6), closed in a follow-up.
- **Disk-persisting the grid layout to Rust** — layout is a web-side `localStorage` preference (§ 3
  PR 2d); no Rust round-trip.
- **Rust-side scrollback length control** — the ring stays ~10k; the `terminal_scrollback` setting is
  xterm's web-side buffer only (decision 6e is "slim").
```
