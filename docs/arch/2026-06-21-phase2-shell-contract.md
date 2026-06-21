# Phase 2 Contract — App Shell, Routing, Project Registry & Settings

**Date:** 2026-06-21
**Status:** FROZEN (orchestrator-owned). Extends — does not edit — the M1 contract
(`2026-06-21-m1-contract.md`). M1's Task model, `TaskStatus`, `nc:task`/`nc:session`
events, and the 6 task commands are unchanged; tasks simply become **project-scoped**.

Goal: bring the designed app to life — sidebar shell + project switcher, routing
between Board / Projects / Settings, and the Projects/Settings/New-Project surfaces
wired to **real persisted data** instead of presentational mocks. The design lives
in `design/project/Nightcore.dc.html`; honor it (cosmic-dark, purple primary,
JetBrains Mono meta, M2/M3 roadmap badges on not-yet-live controls).

## A. Models (serde `rename_all = "camelCase"`)

```
Project {
  id: string,            // uuid v4
  name: string,
  path: string,          // absolute repo path
  branch: string | null, // current git branch, best-effort
  createdAt: string,     // ISO8601
  lastActiveAt: string | null
}

Settings {
  defaultModel: string,        // "opus-4.8" | "sonnet-4.6" | "haiku-4.5"
  defaultEffort: string,       // "low" | "medium" | "high"
  maxConcurrency: number,      // 1..=6  (persists; M2 loop not yet enforcing it)
  permissionMode: string,      // "auto-accept" | "plan" | "ask" (persists; M3 — runtime still auto-denies)
  theme: string,               // accent/theme id, default "cosmic"
  cleanupWorktrees: boolean,   // M2 toggle, persists only
  notifyOnComplete: boolean,   // M3 toggle, persists only
  projectOverrides: Record<string /*projectId*/, SettingsOverride>
}
SettingsOverride { defaultModel?, defaultEffort?, maxConcurrency?, permissionMode? }
```

## B. Persistence
- Global registry + settings live in Tauri's **app config dir**
  (`app.path().app_config_dir()`): `projects.json`, `settings.json`, `active.json`
  (holds `{ activeProjectId }`). Pretty JSON, write-through, load-on-startup —
  mirror `TaskStore`'s style and test approach.
- Per-project tasks stay where M1 put them: `<project.path>/.nightcore/tasks/<id>.json`.

## C. Tauri commands (snake_case → camelCase TS bridge)
Projects:
- `list_projects() -> Vec<Project>`
- `create_project(path: String, name: String) -> Result<Project,String>`
  — validate path is a git repo (a `.git` exists); error if not. Scaffold
  `<path>/.nightcore/`. Persist + activate.
- `delete_project(id: String) -> Result<(),String>` — remove from registry only
  (leave the repo + its `.nightcore/` on disk; deleting files is destructive).
- `active_project() -> Option<Project>`
- `set_active_project(id: String) -> Result<Project,String>` — re-point the
  TaskStore to that project's tasks dir, reload, bump `lastActiveAt`.
- `is_git_repo(path: String) -> bool`
- `git_init(path: String) -> Result<(),String>`

Settings:
- `get_settings() -> Settings`
- `update_settings(patch: SettingsPatch) -> Result<Settings,String>` — shallow
  merge; `projectId?` field in the patch targets a per-project override instead of global.

## D. Events
- `nc:project` — emitted on create / delete / activate. Payload: `{ type: "created"|"deleted"|"activated", project: Project|null, projects: Project[] }`. The webview re-renders the switcher + Projects view; on `activated` it re-calls `list_tasks` to reseed the board.
- `nc:task` / `nc:session` — unchanged (now reflect the active project's store).

## E. TaskStore re-scoping
`TaskStore` gains an interior-mutable target dir (e.g. `Mutex<PathBuf>` alongside the existing map) and a `retarget(dir)` that clears + reloads. `set_active_project` calls it. With **no** active project, the board is empty and the app opens on the Projects view. Keep all existing M1 task tests green.

## F. Frontend — shell, routing, wiring
- **Shell** (`components/app/**`, a **composition root** — add it to the eslint composition-root allowlist so it may import board/projects/settings/ui; mirror shiranami's `COMPOSITION_ROOT_FEATURES`). Sidebar: brand, **project switcher** (active project + dropdown of `list_projects`, "+ New project"), nav (Board / Projects / Settings), footer (running-agents indicator + version), collapse. Optional splash on first mount per the design.
- **Routing**: a small `view: 'board' | 'projects' | 'settings'` state machine in the shell (no router dep for 3 views). New Project dialog + the Logs/TaskDetail drawer are overlays. `App.tsx` becomes the shell host.
- **Wire to real data**:
  - Projects view → `list_projects` / `create_project` / `delete_project` / `set_active_project`; live counts derived from the active project (best-effort).
  - New Project dialog → folder picker via `@tauri-apps/plugin-dialog`, `is_git_repo` (+ `git_init` offer), `create_project`.
  - Settings → `get_settings` / `update_settings`; Global vs Project scope toggle writes global or `projectOverrides[activeId]`.
  - Board → unchanged, now reseeds on `nc:project` `activated`.
- **Roadmap controls** (Auto Mode toggle, concurrency slider live behavior, interactive permission mode) stay **visible but disabled + roadmap-badged**. `maxConcurrency`/`defaultModel`/`permissionMode` still **persist** to settings — they just aren't enforced by a loop yet.
- **Browser-preview** (`!isTauri()`): bridge commands no-op with sensible mock data so Storybook/dev stays usable.

## G. Out of scope (later)
The auto-loop, real concurrency, worktrees, plan-approval, interactive permission UI
(those are M2/M3 per `2026-06-21-m2-design.md`). Phase 2 only makes the controls
persist and the four views navigable on real project/settings data.
