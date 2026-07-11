# Manual UI Dogfood Checklist — Nightcore desktop

_Part of #150 (E2E ladder ring 1). Companion to the MockRuntime Rust suite
(`apps/desktop/src-tauri/src/e2e/`) and the `bun run dogfood:gh` harness._

## Why this is manual

Nightcore's UI runs in a macOS **WKWebView, which exposes no CDP / WebDriver**, so
there is no way to script the real board, terminal, or dialogs from CI. The
MockRuntime Rust suite covers the engine/store contracts headlessly and the
`dogfood:gh` harness drives GitHub flows against a scratch repo — but the
**interactive, pointer- and keyboard-driven paths below can only be verified by a
human clicking through the running app.** This 15-minute pass is that verification.

Everything here is a signed/dev build of the real app (not the mock web server or
the headless sidecar). Cross-check anything surprising against the log:

```
~/Library/Logs/dev.shirone.nightcore/
```

## Prerequisites

- [ ] `claude` CLI installed and signed in (`claude` resolves on `PATH`; the app
      does **not** bundle it). Codex optional.
- [ ] Sidecar compiled, then the app launched: `bun run --filter @nightcore/sidecar compile`
      then `bun run desktop` — or an installed DMG build.
- [ ] A throwaway **scratch git project** opened in Nightcore (a repo you can let an
      agent write a one-line file into). A committed initial state, so a diff is visible.
- [ ] macOS (the confined-tab and Keychain flows are macOS-only; skip §5–§6 elsewhere).
- [ ] Tail the log in a second window if you want live cross-checks:
      `tail -f ~/Library/Logs/dev.shirone.nightcore/*.log`

**Nav shortcuts** (bare letter, only when NOT typing in a field and no modifier held):
`K` Board · `W` Worktrees · `L` Terminal · `R` History · `T` Issue Triage ·
`U` Find & Grade · `H` Propose · `E` Conventions · `P` PR Review · `S` Settings.

---

## §1 — Terminal cockpit (~5 min)

Setup: press `L` to open the Terminal view (scratch project open).

- [ ] Empty state shows "No terminals open" with an **Open a terminal** button.
- [ ] Press **⌘T** → the "Open a terminal" picker opens (repo root + any worktrees
      listed, plus **Browse…** and **Create new worktree…** rows).
- [ ] Pick the **repo root** → a live shell opens in a new tab; the prompt is at the
      project path. Tab carries a **terminal glyph** and an auto/identity title.
- [ ] Type `ls` + Enter → output renders in the pane.
- [ ] Press **⌘T** again, click **Browse…** → the folder browser opens; pick any
      folder outside the project (⌘↵ selects the highlighted path) → a second shell
      opens **cwd'd to that folder** (any-dir spawn).
- [ ] **Double-click** a tab's title → inline rename field; type a name + Enter →
      tab keeps that name (a manual rename **locks** it against AI naming).
- [ ] Click the **Grid view** toggle (top-right of the tab strip) → both panes tile
      side by side. The **Broadcast** toggle appears (disabled until 2+ visible panes;
      it arms only in grid).
- [ ] With grid active and a pane focused, press **⌘⇧E** → that pane **zooms** to fill
      the grid; press **⌘⇧E** again → back to the full grid. (Zoom is not persisted.)
- [ ] Toggle back to **Tabs view**. Resize the app window → the active PTY reflows
      (columns/rows track the pane; no clipped output).
- [ ] Switch to an inactive tab that received output while hidden → its **unread badge**
      was showing and clears on activation.
- [ ] Press **⌘W** (or hover a tab → the ✕) → the **"Close terminal?"** confirm dialog
      appears; confirm → the shell + tab are gone. (⌘W must NOT close the app window.)

Note: the picker copy warns "Your shell runs with full permissions, outside the agent
guardrails" — expected; the user terminal is intentionally ungoverned.

## §2 — Board drag-and-drop (~2 min)

Setup: press `K` for the board; ensure at least one **Backlog** card exists
(use **New task** in the header, or reuse one). Columns are Backlog · In Progress ·
Verifying · Waiting Approval · Done · Failed.

- [ ] Click-drag a Backlog card a few px → it lifts (scaled overlay clone follows the
      pointer; the source card dims). A press under ~6px is a click, not a drag.
- [ ] Drop it on **Done** → the card moves to Done and its status updates.
- [ ] Drag a card and hover **In Progress** and **Verifying** → neither accepts the drop
      (inert droppables); releasing there is a **no-op** (card snaps back).
- [ ] Drag a `ready` card back onto **Backlog** → **no-op** (no silent demotion to backlog).
- [ ] A running (`in_progress`) or `verifying` card is **pinned** — it won't start a drag.

## §3 — Plan-park / plan-approval gate (~3 min)

Setup: **New task** (board header). Title it e.g. "add HELLO.md", give a one-line
description, set **Kind = Build**, **Permission mode = Plan**, then **⌘↵** (Create task).

- [ ] Open the card and press **Run** (or Run from the card). The agent produces a plan
      and stops — the card moves to the **Waiting Approval** column.
- [ ] The task drawer shows a **"Proposed plan"** section (info-tinted markdown) with the
      agent's plan, and the footer shows **Approve · Refine · Reject**.
- [ ] Click **Refine** → the button shows "Refining…"; the agent revises and re-parks a
      new plan (card stays in Waiting Approval).
- [ ] Click **Approve** → "Approving…"; the plan is accepted and the run continues — the
      card **leaves Waiting Approval** (into In Progress). Keep this task for §4.
- [ ] (Optional, separate task) **Reject** a parked plan → the card leaves Waiting Approval
      (discarded) rather than continuing.

## §4 — Review verdict + worktree diff/merge (~3 min)

Setup: let the §3 task finish. A Build task runs in an isolated worktree, then enters
**Verifying** (a reviewer session), then parks or completes.

- [ ] While verifying, the card sits in **Verifying** with a pulsing dot; the footer offers
      **Cancel run** (not Run).
- [ ] When the reviewer verdict lands, the drawer's **Result → Reviewer verdict** shows the
      parsed verdict badge (**Passed / Changes requested / Failed**) over the verdict markdown.
- [ ] If it parked at Waiting Approval on the verdict, the panel shows **Accept · Rerun ·
      Reject**. Click **Rerun** → "Rerunning…" re-runs verification; then **Accept** →
      "Accepting…" and the card moves to **Done**. (A structure-lock failure instead shows a
      red "Structure lock failed" alert and blocks verify/merge.)
- [ ] In the **Done** column, the drawer footer offers **Commit** → after commit it becomes
      **Merge** (needs a verified task + passing gauntlet). Run the **readiness gauntlet**
      from the Result band first if Merge is disabled.
- [ ] Press `W` (Worktrees). The task's worktree row offers **View diff / Merge / Discard**.
- [ ] Click **View diff** → the "Changed files" modal lists each changed file with a status
      pill and `+adds −dels`, and a git summary line. Esc / click-outside closes it.
- [ ] Click **Merge** → the **merge preview** dialog shows a read-only merge-tree preview;
      confirm → the branch merges into the base (abort-on-conflict, never force). The card
      shows **Merged**.
- [ ] (Optional) On a different worktree, **Discard** → confirm → the worktree + branch are
      removed.

## §5 — Usage meter enable + Keychain prompt (~1 min, macOS)

Setup: look at the **sidebar footer** (both unified and classic layouts).

- [ ] Before enabling, the footer shows a single **"Enable usage meter"** button (bolt icon).
- [ ] Click it → a **macOS Keychain permission prompt** appears (the app reads the
      `Claude Code-credentials` generic-password item). Click **Allow**.
- [ ] The button is replaced by a **per-provider row** (Claude, and Codex if signed in) with
      utilization bar(s) (session `5h` + `weekly`) and a reset countdown. Color: green <60%,
      amber <85%, red above.
- [ ] Click a provider row → a **detail popover** opens with all windows; opening it lazily
      runs a **cost scan** (spinner → dollar figure). Esc closes it.
- [ ] A not-connected provider shows a dormant, muted "not connected" row (no prompt).

Note: the read is **read-only** (never writes/refreshes the token) and the token is dropped
immediately. Denying the Keychain prompt should degrade to "not connected", not crash.

## §6 — Confined (sandboxed) terminal tab (~1 min, macOS)

Setup: press `L`, then **⌘T** to open the terminal picker.

- [ ] The picker shows a **"Confined (writes limited to this folder)"** checkbox (macOS only;
      off by default, with the lock icon + explainer). Tick it.
- [ ] Pick the repo root (or Browse a folder) → the shell launches inside the Seatbelt
      write-sandbox; the tab's identity glyph is a **lock (amber)**, not the terminal glyph.
- [ ] In the confined shell, write **inside** the folder: `echo hi > ./nc-confine-test.txt`
      → succeeds.
- [ ] Write **outside** the folder: `echo hi > ~/nc-confine-outside.txt` → **permission
      denied** (writes are contained; reads and network stay open).
- [ ] Fail-closed check: the confined spawn either sandboxes or **refuses with an inline
      error** in the picker (the picker stays open) — it never silently launches unconfined.

---

## Where this fits

| Layer | Covers | This checklist |
|---|---|---|
| MockRuntime Rust suite (`apps/desktop/src-tauri/src/e2e/`) | engine/store/lifecycle contracts, headless | — |
| `bun run dogfood:gh` harness | GitHub PR/issue flows vs a scratch repo | — |
| **This doc** | WKWebView-only interactive UI: terminal cockpit, board DnD, plan gate, review + diff/merge dialogs, usage meter + Keychain, confined tabs | **✓** |

Log any failure with the offending section number and the relevant lines from
`~/Library/Logs/dev.shirone.nightcore/`.
