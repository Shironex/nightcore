# Research: kirei Patterns → Nightcore Production Flow

**Date:** 2026-06-21
**Agent:** kirei (analyst, Agent A)
**Status:** complete — read-only research, nothing committed

## Problem

Nightcore (Rust + Tauri autonomous Claude dev studio; M1–M3 shipped: Kanban
board, per-task Claude Agent SDK sessions via a Bun sidecar, auto-loop
coordinator running N tasks in parallel, per-task git worktrees, dependency
ordering, circuit-breaker, plan-approval gate, interactive permission approval,
commit/merge) runs *autonomous coding tasks* but has no structured
research-before-build, no verification/review gate before "Done", no goal→backlog
decomposition, no role specialization, and no task artifacts. kirei (the user's
own Claude Code plugin, v1.10.0) is a mature *orchestration-with-verification*
system. This doc extracts kirei's transferable patterns and maps each to a
concrete Nightcore addition.

Sources read:
- Local plugin cache `~/.claude/plugins/cache/kirei/kirei/1.10.0/` — README,
  `.claude-plugin/{plugin,marketplace}.json`, `skills/kirei/SKILL.md`,
  `skills/kirei-chain/SKILL.md`, `agents/{kirei,kirei-build,kirei-forge,kirei-review}.md`,
  `scripts/write-findings.py`, `templates/findings.md`.
- Repo: `Shironex/kirei` (public, MIT) — confirmed via plugin manifest homepage.
- Nightcore: `docs/arch/2026-06-21-nightcore-studio-architecture.md`,
  `apps/desktop/src-tauri/src/{task.rs,plan_approval.rs}`,
  `apps/desktop/src-tauri/src/m2/coordinator.rs`.

---

## Part 1 — What kirei actually is (confirmed)

A Claude Code plugin: a **team of specialized agents** driven by **orchestrator
skills**. Three moving parts.

### 1a. Agent taxonomy
- **Research agents** (model: opus, read-only — they never write impl code):
  `kirei` (general), `kirei-security`, `kirei-ui`, `kirei-refactor`, `kirei-perf`,
  `kirei-arch`, `kirei-test`, `kirei-migrate`, `kirei-review`, `kirei-debug`,
  `kirei-data`, `kirei-deps`, `kirei-observability`, `kirei-bundle`,
  `kirei-license`, `kirei-error`, `kirei-eval`, `kirei-sentry`. Each owns a
  **domain lens** and a **findings folder** (`docs/<category>/`).
- **Execute agents** (implement findings):
  `kirei-build` (sonnet) — focused/single-file; `kirei-forge` (opus) —
  multi-file/architectural/ordering-matters.

### 1b. Skill orchestration
- `/kirei [task]` — single-lens orchestrator. Workflow: **parse flags → detect
  task type (keyword table + tie-breakers) → detect execute complexity
  (build vs forge) → announce → spawn research agent (foreground) → review its
  handoff + verify the findings file was written → spawn execute agent →
  report.** Flags: `--research-only` (skip execute), `--findings <path>` (skip
  research, reuse a doc), `--pr N`, `--address-pr-comments N`.
- `/kirei-chain [task]` — **parallel multi-lens**. Detect ≤4 lenses → spawn all
  research agents **in one message (concurrent)** → wait all → **merge into one
  combined doc** with explicit **Cross-Cutting Themes**, **Conflicts Between
  Lenses**, and a **Unified Priority Order**. Research-only by design.
- `/kirei-audit` — depth-tunable (quick/standard/deep caps parallel budget at
  1/3/6); a **scout pass sizes** the real agent count to repo size; merges into
  **one dependency-ordered cleanup plan**; fixes run **sequentially, phase by
  phase, verifying typecheck/tests between each phase**.
- `/kirei-deps`, `/kirei-sentry`, `/kirei-discuss`, `/kirei-templatize` — purpose-built flows.

### 1c. The handoff + findings-doc mechanism (the spine)
- Every research agent ends with a structured **`## KIREI HANDOFF`** block:
  Task, Findings-doc path, Root Cause, Location (file:line), Recommended fix
  (numbered per file), **Execute complexity (SIMPLE→build | COMPLEX→forge)**,
  Gotchas, Verification, Open questions.
- Every agent **must** persist a findings markdown to `docs/<category>/YYYY-MM-DD-<slug>.md`
  via `scripts/write-findings.py` (mkdir -p + dated filename + stdin body).
  The findings file is a **non-negotiable deliverable**; if it can't be written
  the agent prints `FINDINGS FILE NOT WRITTEN` and the orchestrator writes it
  from the handoff. Findings persist across sessions, sorted by domain.
- Execute agents emit a **`## KIREI-BUILD/FORGE COMPLETE`** block: ordered
  changes, a **Verified checklist** (typecheck passes, tests pass, findings-doc
  verification step, "no missed call sites"), and **Deviations from findings**.

### 1d. Model routing (complexity-based)
- Research is always opus (analysis is the expensive-to-get-wrong part).
- Execution routes by **scope complexity**: sonnet (`build`) for focused work,
  opus (`forge`) for multi-file/ordering. The research agent **recommends** the
  tier; the orchestrator **decides** and can **upgrade build→forge** if review
  reveals more scope. "When in doubt, pick forge."

### 1e. Verification / chain / adversarial patterns
- **Research-before-execute** is the core invariant: no code until a validated
  findings doc exists.
- **AskUserQuestion after investigation, before handoff** — findings validated
  with the human once analysis is done (not a scope conversation up front).
- **kirei-review as a standalone review lens** — reviews a diff (local branch or
  PR), surfaces evidence-based issues, and in `--address-pr-comments` mode
  **classifies each comment** (valid / invalid / out-of-scope / nit / resolved)
  so only valid ones reach an execute agent. The reviewer never edits code.
- **kirei-chain conflict surfacing** — when two lenses disagree, the merge names
  the conflict instead of silently picking one (adversarial cross-check).
- **Orchestrator review step** — after research, the orchestrator spot-checks
  1–2 referenced paths exist and confirms the complexity call before executing.

---

## Part 2 — Transferable patterns

kirei orchestrates *many specialized agents with verification*; Nightcore runs
*autonomous coding tasks*. Today a Nightcore task is a single bare prompt
(`task.prompt()` = title + description) handed to one SDK session in a worktree;
the only gate is plan-approval, and a task reaches `Done`/`Verified` purely on
the session exiting cleanly — no independent check that the work is correct. The
high-value kirei patterns to port:

1. **Research-before-build per task** — a read-only research pass writes a
   findings doc the build session consumes, instead of the model researching and
   coding in one undifferentiated session.
2. **Specialized reviewer/verifier agent as a post-run gate** — between
   `in_progress` and `Done`, a separate kirei-review-style session reviews the
   task's diff and emits a pass/fail verdict. This is the single biggest gap
   (kirei's `kirei-review` is the exact template, and `--address-pr-comments`'s
   classify-then-act is the exact gate shape).
3. **Parallel multi-lens review of a task's diff** — fan out security + perf +
   correctness reviewers over one diff, merge with conflict-surfacing
   (`/kirei-chain` shape) for high-risk tasks.
4. **Complexity-based model routing** — pick sonnet vs opus per task from scope
   signals instead of one configured model for everything.
5. **Structured findings as task artifacts** — persist research/review/verdict
   markdown per task (kirei's `docs/<category>/` + handoff blocks) so a task
   carries an auditable trail and re-runs can reuse prior findings.
6. **Adversarial verification before Verified** — the reviewer is a *different*
   session (optionally a different model) with a "find the problem" mandate, so
   marking `Verified` requires an independent pass, not self-attestation.
7. **Goal→backlog decomposition agent** — a planning session that turns one
   high-level goal into ordered subtasks **with dependency edges**, written
   straight into the existing `Task.dependencies` graph the coordinator already
   honors.
8. **Phased sequential execution with verify-between** (`/kirei-audit` shape) —
   for a decomposed epic, run phases in dependency order and verify between each,
   rather than firing everything the moment slots free up.

---

## Part 3 — Mapped additions for Nightcore

Each as "Nightcore could add X": what, why (production leverage), effort
(S/M/L), where it lives, and how it composes with plan-gate + worktrees + auto-loop.

### A. Agent role presets ("task kind") — the enabling primitive
- **What:** a small enum of task *kinds* (`build` default, `research`, `review`,
  `plan`/`decompose`), each a preset: system-prompt prefix, allowed-tools/
  permission-mode, model tier, and whether it writes code or only artifacts.
  Mirrors kirei's agent-`.md` files. Lives as data, not new processes.
- **Why:** every other addition below is a composition of kinds. A `research`
  kind is read-only; a `review` kind is read-only + "find problems"; `build` is
  today's behavior. This is the seam that makes the rest cheap.
- **Effort:** **M.** Add `kind` to `Task` (serde default = `build`, so existing
  task JSON still loads — same back-compat pattern as the M3 `plan`/`committed`
  fields). The sidecar's `start-session` gains a preset selector; presets are
  config (`~/.nightcore` / per-project `.nightcore`).
- **Where:** `Task` in `task.rs` (new field) · Rust core (preset resolution at
  `launch`) · sidecar (apply system-prompt/tools/permission-mode) · web (kind
  picker on the card) · a new `presets` package or config block.
- **Composes:** the coordinator already routes per-task `model`, `cwd`, and
  `permission_mode` at `launch()` (coordinator.rs:372–382) — preset resolution
  slots in right there. Read-only kinds (research/review) can even skip worktree
  allocation (run in the base tree) since they don't write.

### B. Research-before-build per task (two-phase task)
- **What:** a task with `kind=build` and "research first" enabled runs a
  read-only **research session** that writes `.nightcore/tasks/<id>/research.md`
  (kirei findings shape: root cause, files-to-modify, gotchas, verification),
  then a **build session** prompted with that doc. Two SDK sessions, one task.
- **Why:** kirei's core invariant — separating "decide what to change" from
  "change it" — measurably reduces wrong-scope churn and gives the build phase a
  concrete plan. Production flows want the plan inspectable before bytes move.
- **Effort:** **M.** Mostly orchestration: a per-task phase state machine in the
  coordinator (`Research → (artifact) → Build`).
- **Where:** Rust core (phase field on the in-flight task + sequencing in the
  reader's terminal handler) · sidecar (run a read-only session) · web (show the
  research artifact, like the plan panel already shows `plan`).
- **Composes:** this *is* the existing plan-gate generalized. Plan-mode already
  produces an artifact (`Task.plan`) and parks for approval; research-before-build
  is the same "produce artifact → optionally gate → proceed" loop with a
  richer doc. Reuse the `waiting_approval` status to optionally gate on the
  research doc.

### C. Post-run verification gate (the headline borrow)
- **What:** a new status **`Verifying`** between `InProgress` (terminal success)
  and `Done`. On a build session finishing, the coordinator auto-dispatches a
  **review session** (`kind=review`, read-only) over the task's worktree diff
  (`git diff <base>..HEAD`), which emits a structured verdict
  (`PASS` | `CHANGES_REQUESTED` | `FAIL`) + findings to
  `.nightcore/tasks/<id>/review.md`. PASS → `Done`; CHANGES_REQUESTED →
  auto-loop a bounded build-fix iteration (feed the review back, like
  `--address-pr-comments`); FAIL/over-budget → `WaitingApproval` for a human.
- **Why:** this is the missing production gate. Today `Done` means "the session
  exited", not "the work is correct". An independent reviewer is exactly how
  kirei keeps quality; `kirei-review` + the classify-then-fix loop is a turnkey
  template.
- **Effort:** **L.** New status (serde-additive), a verdict contract
  (structured, parseable — reuse the NDJSON event spine), the fix-iteration
  loop with an iteration cap (lean on the existing circuit-breaker for runaway
  protection), and worktree-diff plumbing.
- **Where:** `TaskStatus` in `task.rs` (+ `Verifying`) · Rust core (auto-dispatch
  in the terminal-event handler; iteration budget; verdict parsing) · sidecar
  (review session) · web (Verifying column + review-findings panel + the
  approve/reject controls already built for plan-gate).
- **Composes:** slots/breaker/worktrees already exist — a review session is just
  another leased run in the same worktree. The verdict reuses the parked-decision
  UX from plan-approval (`plan_approval.rs`): same approve/reject/refine controls,
  new trigger. The `committed`/`merged` flags already gate on review — make
  commit/merge **require** a PASS verdict.

### D. Goal→backlog decomposition agent
- **What:** a `kind=decompose` session takes one high-level goal and emits a
  **set of subtasks with dependency edges**, written straight into the task
  registry via the existing `create_task` path, populating `dependencies` so the
  coordinator's `eligible_tasks`/`is_blocked` ordering picks them up unchanged.
- **Why:** Nightcore can run a dependency-ordered backlog but has no way to
  *produce* one — a human hand-authors every card. Decomposition turns
  "build feature X" into a runnable, ordered backlog and is the natural front
  door to the autonomous loop. kirei's `/kirei-audit` scout+phase-plan is the
  closest analog (size the work, emit an ordered plan).
- **Effort:** **M.** The decompose session emits structured JSON (subtask list +
  edges) over the NDJSON spine; the core writes tasks + wires `dependencies`.
  Add a "decompose into subtasks" action on a backlog card.
- **Where:** sidecar (decompose session, structured output) · Rust core (fan the
  result into `create_task` + set `dependencies`) · web (goal card → "decompose"
  → review proposed subgraph before accepting).
- **Composes:** `Task.dependencies` + `deps.rs` (`eligible_tasks`, `is_blocked`)
  already enforce ordering at every tick. Decomposition just *writes* the graph
  the coordinator already reads — zero coordinator change. Gate acceptance of the
  proposed subgraph through the same human-review UX as the plan-gate.

### E. Complexity-based model routing (auto build/forge tier)
- **What:** when a task's `model` is unset, infer a tier (sonnet vs opus) from
  signals — description length, file-count hints, dependency fan-in, or the
  research doc's own SIMPLE/COMPLEX recommendation — instead of always using the
  project default.
- **Why:** kirei's build-vs-forge split is its cost/quality lever: cheap model
  for focused work, expensive for sprawling work, decided per task. Nightcore
  already stores per-task `model` but only ever sets it manually.
- **Effort:** **S.** A pure function `infer_tier(&Task, research_doc) -> Model`
  consulted at `launch` only when `task.model` is `None`. Heuristic first; later
  let the research/decompose session emit the recommendation (kirei has the
  research agent recommend, orchestrator decide).
- **Where:** Rust core (one helper, called in `launch()` where `task.model` is
  already read) · optionally sidecar (research session emits a tier hint).
- **Composes:** `launch()` already passes `task.model` to `start_session`
  (coordinator.rs:377). The inference is a fallback when that's `None` — additive,
  no contract change.

### F. Structured task artifacts (per-task findings trail)
- **What:** per-task artifact dir `.nightcore/tasks/<id>/` holding
  `research.md`, `review.md`, `verdict.json`, run transcripts — the kirei
  `docs/<category>/` idea scoped to a task instead of a domain.
- **Why:** auditability and reuse. A failed/re-run task carries its prior
  findings (kirei's `--findings <path>` reuse); the human can read *why* the
  agent did what it did. Production autonomy needs a paper trail.
- **Effort:** **S–M.** A write helper (the Rust analog of `write-findings.py`)
  plus reads from the web side. Artifacts are the connective tissue B/C/D pass
  between phases anyway, so this largely falls out of those.
- **Where:** Rust core (artifact dir helper) · sidecar (sessions write their
  artifact) · web (artifact viewer on the card detail).
- **Composes:** lives beside the existing per-project `.nightcore/` state.
  Artifacts are how phases hand off (research→build, build→review), mirroring
  kirei's findings-doc-as-contract.

### G. Parallel multi-lens review for high-risk tasks (chain over a diff)
- **What:** for tasks flagged high-risk (touches auth/payments/migrations, large
  diff), the verification gate (C) fans out 2–3 review lenses
  (security + correctness + perf) **concurrently** over the same diff and merges
  with **conflict-surfacing** before the verdict — the `/kirei-chain` shape
  applied to one task's changes.
- **Why:** single-reviewer gates miss cross-cutting issues; kirei built chain
  precisely because one lens isn't enough for risky surfaces. Reserve the cost
  for risky tasks only.
- **Effort:** **L** (do after C; it's C generalized to N reviewers + a merge).
- **Where:** Rust core (fan-out + merge of N review sessions; reuse slot pool) ·
  sidecar (lens sessions) · web (per-lens verdict breakdown).
- **Composes:** the slot manager already runs N concurrent sessions; multi-lens
  review is N leased review runs against one worktree, merged like kirei-chain.

### H. Phased execution with verify-between (epic runner)
- **What:** for a decomposed epic (D), run phases in dependency order and only
  release the next phase after the prior phase's tasks pass verification (C) —
  kirei-audit's "fix sequentially, verify between phases."
- **Why:** prevents a broken early phase from cascading wasted runs across a
  dozen dependent tasks. Production autonomy needs blast-radius control.
- **Effort:** **M**, but only meaningful once C + D exist.
- **Where:** Rust core (coordinator gates phase N+1 eligibility on phase N
  verified, not just `Done`).
- **Composes:** `eligible_tasks` already gates on deps being terminal; tighten
  the bar from `Done` to `Verified` (post-C) so the dependency graph enforces
  verify-between for free.

---

## Part 4 — Top 5 highest-leverage borrowings (ranked)

1. **Post-run verification gate (C)** — the single biggest production upgrade.
   Turns `Done` from "session exited" into "independently reviewed and passed,"
   with an auto-fix loop for CHANGES_REQUESTED. Directly ports `kirei-review` +
   the `--address-pr-comments` classify-then-fix loop. Gate commit/merge on PASS.
   *Effort L; depends on A.*
2. **Agent role presets / task kinds (A)** — the enabling primitive. Cheap, and
   B/C/D/G all compose from it. Ship first. *Effort M.*
3. **Goal→backlog decomposition agent (D)** — the missing front door: produces
   the ordered, dependency-edged backlog the coordinator already knows how to
   drain. Writes straight into the existing `dependencies` graph. *Effort M.*
4. **Research-before-build per task (B)** — generalizes the existing plan-gate
   into kirei's research→build invariant; gives every build a concrete,
   inspectable plan and cuts wrong-scope churn. *Effort M.*
5. **Complexity-based model routing (E)** — highest leverage-per-effort. One
   inference helper at `launch()` when `model` is unset turns the
   already-stored per-task `model` field into kirei's build/forge cost lever.
   *Effort S.*

(Runners-up: structured task artifacts F is near-free once B/C/D land and is the
glue between phases; multi-lens review G and phased epic runner H are strong but
are generalizations of C/D and should follow them.)

## How to verify these land well
- A: existing task JSON still deserializes (serde default `kind=build`); a
  read-only `research`/`review` task never writes to the worktree.
- C: a task with an intentionally-wrong diff lands in `Verifying`→
  `CHANGES_REQUESTED`, not `Done`; commit/merge is refused without a PASS.
- D: decomposing a goal creates N tasks whose `dependencies` reproduce the
  proposed edges and whose eligibility order matches `eligible_tasks`.
- E: a task with `model=None` and a short description routes to sonnet; a
  large/multi-file one routes to opus.

## Open questions
- Reviewer model policy: same model as build (cheaper, but a model reviewing
  itself is weaker adversarially) vs. forced different/stronger model for the
  gate. kirei keeps research on opus regardless — lean toward opus-reviews-sonnet.
- Iteration cap for the CHANGES_REQUESTED auto-fix loop, and whether it shares
  the circuit-breaker budget or has its own.
- Whether research/review sessions skip worktree allocation (run read-only in
  the base tree) or still get a worktree for isolation consistency.
