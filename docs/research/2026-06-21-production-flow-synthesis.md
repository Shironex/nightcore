# Nightcore → Production Flow: Synthesis of Aperant + AgentSystemLabs/core + kirei

**Date:** 2026-06-21 · **Status:** RESEARCH ONLY (nothing committed; no implementation).
Sources (per-repo detail): `2026-06-21-aperant-analysis.md`, `2026-06-21-agentsystemlabs-analysis.md`, `2026-06-21-kirei-patterns-analysis.md`.

Nightcore today (M1–M3): per-project Kanban, Bun-sidecar Claude sessions, auto-loop + concurrency, per-task git worktrees, dependency ordering, circuit-breaker, plan-approval gate, interactive permissions, commit/merge, project registry + settings. **Gap, in one line:** a task is *one bare prompt → one session → "Done" on session-exit*; nothing independently checks the work, right-sizes the effort, or decomposes a goal. That's the production layer all three repos encode.

> Note: `docs/architecture.md` still describes the *archived* TS CLI/TUI harness (v0). The current arch is the Rust+Tauri studio — that doc is stale (worth refreshing later; not part of this research).

---

## The convergence (where ≥2 independent analyses agree — highest signal)

| Theme | Aperant | AgentSystem | kirei | Verdict |
|---|---|---|---|---|
| **Independent verification before "Verified"** | reasoning QA loop (5 iters, critical-vs-cosmetic triage, scoped fixer) | gated read-only reviewer fleet (severity + file:line + `auto-fixable`, fires only when gate trips) | review-as-gate (PASS/CHANGES_REQUESTED/FAIL, `--address-pr-comments` classify-then-fix) | **#1 — all three. Build this first.** |
| **Complexity / depth routing** | complexity_assessor → pipeline length + validation set | `mode=fast\|balanced\|production` dial | build(sonnet) vs forge(opus) model routing | **#2 — all three.** |
| **Goal → backlog decomposition** | spec_{gatherer,researcher,writer,critic} + planner | (skills assume a clear ask) | `decompose` agent → subtasks + dependency edges | **#3 — front door; writes the dep graph the coordinator already drains.** |
| **Persistent project memory** | `.nightcore`-style project memory auto-injected | NEVER-blocks = durable judgment in prompts | findings docs as reusable artifacts | **#4 — kills convention drift across parallel agents; pure local files.** |
| **Agent role specialization** | per-phase agents (coder/qa/spec/recovery) | reviewer + mapper subagents (read-only, structured artifact) | research vs build vs forge vs review taxonomy | **enabling primitive: task "kind".** |
| **Pre-irreversible gate** | staging/validation recommendations | `check-pr-readiness` gauntlet (stop at first fail) + `check-release-risk` | verify-between-phases | **deterministic local CI before merge.** |

---

## The full feature catalog (deduped, with where it lives in our 3-tier arch)

**Quality & verification**
- **V1. Post-run verification gate** *(headline)* — new `TaskStatus::Verifying`; on a build session's success, auto-dispatch a **read-only review session over `git diff <base>..HEAD`** → `PASS | CHANGES_REQUESTED | FAIL` + a `review.md` artifact. PASS→Done; CHANGES_REQUESTED→bounded auto-fix loop (feed the review back, like `--address-pr-comments`); FAIL/over-budget→Waiting Approval. **Gate commit/merge on PASS.** Reuses slots/breaker/worktrees + the `plan_approval.rs` approve/refine/reject UX. *[R coordinator+task, B reviewer session, W findings panel + Verifying column] — L*
- **V2. Pre-merge readiness gauntlet** — detect the project's *real* tooling (never invent commands) → typecheck→lint→format→test→residue-sweep (added lines only), **stop at first failure**; gate `merge_task` on it. Deterministic shell, no agent cost. *[R] — M*
- **V3. Multi-lens review for high-risk diffs** — for auth/payments/migrations/large diffs, fan out security+correctness+perf reviewers concurrently, merge with **conflict-surfacing** (`/kirei-chain` over one diff). Slot pool already runs N sessions. *[R+B] — L, after V1*
- **V4. Reviewer model policy** — opus-reviews-sonnet (a model grading itself is weak adversarially). *design rule*

**Right-sizing work**
- **D1. Task "kind" presets** *(enabling primitive)* — enum `build`(default)/`research`/`review`/`decompose`; each a preset (system-prompt, allowed-tools, permission-mode, model tier, writes-code?). `Task.kind` serde-default=`build` (same back-compat trick as the M3 `plan`/`committed` fields). Read-only kinds can skip worktree allocation. *[R task+coordinator, B preset apply, W picker] — M*
- **D2. Depth mode per task** — `fast | balanced | production` dial that selects how many phases + which verifications run (e.g. fast skips V1; production forces V1+V2+tests). High-risk signals can force `production`. *[R+W] — M*
- **D3. Complexity-based model routing** — when `task.model` is `None`, `infer_tier(&Task, research?) -> Model` at `coordinator launch()` (sonnet focused / opus sprawling); later the research session recommends. Purely additive fallback that *activates the per-task model field we already store*. *[R] — S, best leverage/effort*
- **D4. Recovery hop before the breaker trips** — one scoped recovery session on failure before counting toward the circuit-breaker. *[R breaker + B prompt] — S–M*

**Front door & context**
- **F1. Goal→backlog decomposition** — a `decompose` session emits subtasks + dependency edges as JSON → core writes them via `create_task` + sets `dependencies`. **Zero coordinator change** (`deps.rs` already reads the graph). Gate the proposed subgraph through the plan-approval UX. *[R+B+W] — M*
- **F2. Research-before-build** — a read-only research session writes `.nightcore/tasks/<id>/research.md`, then the build session is prompted with it. Generalizes the plan-gate (which already produces `Task.plan` + parks at Waiting Approval). *[R+B] — M*
- **F3. Persistent project memory** — `.nightcore/memory/*.md` (conventions, architecture notes) auto-injected into every session's system prompt. Editable in-app. Kills drift across parallel agents. Pure local. *[R owns, B injects, W editor] — M*
- **F4. Structured per-task artifacts** — `.nightcore/tasks/<id>/{research.md, review.md, verdict.json, transcript}`; enables `--findings`-style reuse on re-runs. Mostly falls out of V1/F1/F2. *[R] — S–M*
- **F5. Spec/PRD pipeline** — populate the empty `packages/skills` with spec gatherer→researcher→writer→critic presets feeding F1. *[B skills + W] — M*

**Surfaces & operations**
- **O1. Headless / scriptable CLI surface** — revive the retired `apps/cli` over the Rust command layer for **CI / unattended runs**. *This is where Nightcore can exceed Aperant (desktop-only).* *[new apps/cli over R] — M*
- **O2. Cost budgeting / quotas** — per-task / per-project / per-day spend caps + a budget bar; cost+usage already ride the B→R wire. *[R+W] — S–M*
- **O3. Release-risk briefing at merge** — categorize the diff (API/schema/auth/env/migration) → HIGH/MED/LOW briefing with deploy-order + rollback notes. Informs, never blocks. *[R+W] — S–M*
- **O4. Notifications / hooks** — on task_success/failed/auto_mode_complete → native notification / shell / webhook (the M3 Settings "Hooks" page is already drawn). *[R+W] — S*
- **O5. Announce-the-mode trust invariant** — whenever a task's pipeline/depth/model is auto-chosen, show it before running; never silently. *design rule, cheap*
- **O6. Ideation / Roadmap / Insights** surfaces (auto-suggested backlog from code smells/security/perf). *[B+W] — L, later*

**Integrations (touch the local-first edge → opt-in, offline-default)**
- **I1. GitHub/GitLab/Linear import + PR-open** — extend `merge.rs` to optionally push a branch + open a PR; import issues as tasks. Strictly opt-in, no background network. *[R+W] — M*
- **I2. Multi-provider** (Codex/others via the existing provider seam) — **conflicts with current Claude-only posture; parked.**

---

## Proposed sequencing (post-M3 milestones)

- **M4 — "Earned Verified" (production confidence):** D1 task kinds → **V1 verification gate** → gate commit/merge on PASS → V2 readiness gauntlet. *The core of a trustworthy autonomous flow.*
- **M5 — "Right-sized work":** D2 depth modes + D3 model routing + D4 recovery hop + V4 reviewer policy.
- **M6 — "Front door & memory":** F1 decomposition + F3 project memory + F2 research-before-build + F4 artifacts (+ F5 skills).
- **M7 — "Surfaces & ops":** O1 headless CLI + O2 budgeting + O3 release-risk + O4 notifications.
- **Later / opt-in:** V3 multi-lens review, I1 GitHub/PR, O6 ideation/roadmap, I2 multi-provider.

## Top 5 (the unanimous, highest-leverage set)
1. **V1 — post-run verification gate** (all three name it #1): make "Verified" *earned*, gate merge on it, auto-fix loop for CHANGES_REQUESTED.
2. **D1 — task "kind" presets**: the enabling primitive V1/F1/F2/V3 all compose from. Ship first.
3. **F1 — goal→backlog decomposition**: the missing front door; writes the ordered dep graph the coordinator already drains.
4. **D3 — complexity model routing** (S effort): activates the per-task model field we already persist; immediate cost/quality lever.
5. **V2 — pre-merge readiness gauntlet**: deterministic local CI gating the one irreversible action.

## Guardrails / open design calls
- Keep **local-first / Claude-only / single-user**; only I1 + auto-update touch the network → opt-in, offline-default. Park I2.
- **Verifying as a Kanban lane vs an in-place gate** on the Done transition — decide before V1 (both write the same status edges).
- **Auto-fix iteration cap** for CHANGES_REQUESTED — share the circuit-breaker budget or its own?
- **Serde-additive** for every new `Task` field (`kind`, depth) and `TaskStatus::Verifying` — extend the existing back-compat test that pins the M3 fields.
- Read-only `research`/`review` kinds: skip worktree allocation (run in base tree) vs. allocate for consistency — pick one.
