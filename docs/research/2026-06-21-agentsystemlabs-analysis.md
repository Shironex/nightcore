# AgentSystemLabs/core — Analysis for Nightcore Production Flow

Date: 2026-06-21
Repo analyzed: https://github.com/AgentSystemLabs/core (public, MIT, read-only research — not cloned)
Marketplace v0.48.2 · plugin `agentsystem-core` v0.33.0 · author webdevcody · site agentsystem.dev

> Important framing note: `AgentSystemLabs/core` is **not** an orchestration product like Nightcore.
> It is a **skill/agent pack** — a library of declarative Markdown "skills" (workflow recipes) and
> read-only "reviewer" subagents that plug into agent CLIs (Claude Code, Cursor, Codex, OpenCode).
> Its value for Nightcore is therefore **methodology, not code**: the production-grade *process* it
> encodes (gated pipelines, depth modes, verification gates, reviewer fan-out) is exactly the layer
> Nightcore currently lacks. Several of these skills are already loaded in this dev environment.

---

## 1. What AgentSystemLabs/core is

A **skill pack for AI coding agents**. The pitch (agentsystem.dev): "you describe a goal, the agent
picks the right engineering workflow and depth, runs the checks that matter, and stops when the code
is ready." The single front door is `/ship`, which classifies intent (CREATE / EVOLVE / POLISH /
REMOVE / FIX / AUDIT), infers a depth mode (fast / balanced / production), announces the pipeline,
delegates to **one** core skill, reports findings, and **stops before git**.

- **Stack:** 100% JavaScript. No runtime engine — the "product" is ~40 `SKILL.md` files (Markdown +
  YAML frontmatter), ~15 reviewer/mapper agent definitions, a thin Commander CLI installer
  (`npx @agentsystemlabs/core init [--harness cursor|codex|opencode] [--global]`), and a Claude Code
  plugin marketplace manifest. Distribution = copy Markdown into the host's skills directory.
- **Architecture (conceptual, 5 layers):** (1) `/ship` intent+depth router → (2) six core workflow
  skills (`add-feature`, `modify-feature`, `polish-ui`, `remove-feature`, `fix-bug`, `audit`) →
  (3) internal handoff skills (`add-migration`, `write-tests`, `add-observability`, `harden-types`,
  `simplify`, `check-pr-readiness`, `check-release-risk`, `commit`, `open-pr`, `release`, …) →
  (4) read-only reviewer subagents (contracts, concurrency, data-integrity, security-regression,
  authz, perf, error-boundaries, loading-states, a11y-regression, client-bundle, observability) plus
  mapper agents (crud-surface-mapper, ui-pattern-inspector, utility-finder, runtime-contract-tracer)
  → (5) report + user decision point.
- **Target user:** "vibe coders" and engineers who want consistent, rigorous workflows without
  memorizing which skill to run or how thorough to be. The tax it removes is *choosing the workflow
  and depth*; the value it preserves is *visibility* into what was decided.
- **Overlap vs Nightcore:**
  - *Overlap (conceptual):* both are autonomous-dev orchestrators that classify work, gate it,
    review it, and stop before publishing. Nightcore's plan-approval gate ≈ `add-feature` Phase 4;
    Nightcore's permission approval ≈ the reviewer fan-out's "surface, don't auto-fix" stance;
    Nightcore's commit/merge ≈ `/commit` + `check-release-risk`.
  - *Difference (fundamental):* AgentSystem is a **stateless prompt library** that runs *inside one
    agent session* on the user's machine; it has **no orchestration runtime, no persistence, no UI,
    no parallelism manager, no worktrees, no Kanban**. Nightcore is the runtime AgentSystem doesn't
    have. They are complementary, not competitive: AgentSystem is "what a single task should *do*
    internally"; Nightcore is "how many tasks get *scheduled, isolated, gated, and merged*."
  - Both are local-first and (effectively) Claude-first — no constraint conflict.

---

## 2. Standout features / patterns

### A. `/ship` — intent-classify + depth-infer router (orchestration)
One entry point maps a free-text goal to one of six workflows via a phrase→intent table, then infers
a **depth mode** from risk signals (auth/payments/migrations/jobs/webhooks/cross-subsystem → always
`production`; single-file/cosmetic/no-data → `fast`; else `balanced`). It **announces** the detected
intent, risk, mode, and numbered pipeline *before* executing, and a `production` run requires explicit
confirm. Key invariant: **never hide which mode/pipeline was chosen** — "it just worked" must be
distinguishable from "it did the wrong thing silently."

### B. Depth modes as a first-class dial (orchestration)
Every core skill accepts `mode=fast|balanced|production` plus `include=`/`skip=` phase overrides.
The mode deterministically selects which phases run (e.g., `add-feature` production = 8 phases + plan
gate + gated reviews + tests; balanced drops the plan gate and some reviews; fast = implement+verify
only). A **mode-safety override**: a `fast` request on a high-risk diff pauses and forces informed
consent rather than silently skipping gates.

### C. `add-feature` — the gated 8-phase production pipeline (orchestration + verification)
Clarify → Explore → Design → **mandatory plan-approval gate** → Implement → **Verify (actually run
the code path, not just typecheck)** → **Gated reviews** → Tests → post-steps (simplify, polish-ui).
Notable encoded rules: persist-vs-derive decision is explicit; CRUD-surface completeness (don't ship a
field to edit-but-not-create); UI sibling-convention parity; "logic-first" and "integration-first"
test lanes; "if implementation reveals the plan was wrong, return to design and re-approve."

### D. Read-only reviewer subagent fleet (verification / quality gates)
~11 specialized reviewers, each a self-contained agent with `tools: Read, Grep, Glob, Bash` and a
hard **"NEVER edit files"** contract. Each returns a **severity-ranked findings report** with
`file:line` for *both* sides of a problem and an `auto-fixable: true|false` flag per finding; the
parent applies mechanical fixes and surfaces the rest. They are **gated** — only reviewers whose gate
the diff trips actually fire (no security review on a CSS-only diff), which keeps findings credible.
Coverage: contracts (producer/consumer drift), concurrency (races/idempotency), data-integrity
(migrations/orphans/uniqueness), security-regression, authz (IDOR/ownership), perf (N+1/hot path),
error-boundaries, loading-states, a11y-regression, client-bundle, observability-coverage.

### E. Mapper subagents — context-isolated investigation (agent coordination)
Read-only agents that do a bounded search and return a structured artifact so the parent's context
stays clean: `crud-surface-mapper` (every create/edit/import surface for an artifact),
`ui-pattern-inspector` (sibling modal/dialog conventions), `utility-finder` (does an equivalent helper
already exist → reuse/extend/write-new), `runtime-contract-tracer` (4-link trigger→dispatch→receive→
observe trace with silent-failure sites flagged). This "spawn a scoped read-only agent, get a
structured report back, don't pollute the orchestrator" is the single most reusable coordination
pattern in the repo.

### F. Subagent fan-out playbook (agent coordination)
An explicit doctrine for *when* parallel agents help vs hurt: fan out only when pieces touch different
files, no piece's contract shape determines another's, each is briefable self-contained, and outputs
won't merge-conflict — otherwise serial. Includes briefing templates (Explore / Implement / Review)
with frozen contracts and "files you must NOT edit" guards. After fan-out: **consolidate and resolve
contradictions explicitly — don't average two conflicting reviews.**

### G. `check-pr-readiness` — the pre-publish gauntlet (verification / CI-substitute)
A deterministic gate: scope the diff vs. base → **detect the project's actual tooling** (read
package.json/Cargo.toml scripts, never invent commands) → run typecheck→lint→format→test→residue-sweep
in order, **stop at first failure** → residue sweep scans **only added lines** for console.log /
debugger / `.only`/`.skip` / new TODOs / dropped lockfiles / stray large binaries → verdict
READY/BLOCKED. Auto-fixes only format, and only after user `y`. Strong "never auto-fix lint/tests"
and "never continue after first failure" invariants.

### H. `check-release-risk` — content-level pre-publish briefing (observability of change)
Sibling to the gauntlet but reviews **content risk, not gate pass/fail**. Seven categorizers over the
branch diff (public-API change, persistence-shape change, auth/payment/permission, new env vars,
manual-QA-needed paths, doc/changelog drift, rollback concerns) → a severity-ranked HIGH/MEDIUM/LOW
briefing with deploy-order and rollback notes. **Informs, never blocks.** Auto-runs as a handoff from
`/commit-and-push`, `/open-pr`, `/release`.

### I. `fix-bug` — runtime-contract-first debugging (verification)
Leads with the concrete runtime contract (endpoints, env, file paths, log locations) and the single
fastest diagnostic before hypotheses; uses `runtime-contract-tracer` to convert "should work but
didn't" into a literal evidence trail; has a `mode=regression` lane that switches from runtime tracing
to git log/blame/bisect.

### J. `audit` — whole-repo orchestrated tech-debt sweep (orchestration)
Maps architecture first, then fans out the entire reviewer family across the repo (not just a diff),
produces a severity-ranked findings report + refactor strategy, applies mechanical fixes inline and
gates structural ones per-item.

### K. Skill-routing integrity check (tooling / self-consistency)
`scripts/check-skill-routing.mjs` parses every SKILL.md's frontmatter, extracts declared callers from
the `description` ("invoked by X"), and **fails CI if a declared caller doesn't actually reference the
callee** — i.e., it statically verifies the orchestration graph is internally consistent. A release
GitHub Action and a test workflow back this.

### L. Encoded "NEVER" blocks with rationale (knowledge / guardrails)
Every skill ends with a `## NEVER` section: each rule is *Instead* (what to do) + *Why* (the failure
mode it prevents). This is durable, transferable engineering judgment in prompt form — the part that
makes the difference between "an agent wrote code" and "an agent shipped production code."

### M. Multi-harness distribution + host-portability fallback (deployment)
One source pack installs into Claude Code (plugin marketplace), Cursor, Codex, OpenCode via the CLI.
`/ship` has an explicit fallback: if the `Skill` tool primitive is missing on a host, **read the
routed SKILL.md and execute it inline**, and *surface the degradation* to the user, rather than
refusing. Versioned, released, diff-driven per-plugin bumps.

---

## 3. Mapped additions for Nightcore

Nightcore 3-tier reminder: **Rust core** (orchestration, worktrees, slots, registry, settings) ·
**Bun sidecar** (Claude Agent SDK session, NDJSON stdio) · **React web** (Kanban, transcripts,
settings). For each borrowing: what / why / effort (S/M/L) / where it lives / constraint flags.

### 3.1 Depth-mode dial per task — from B  ★ (top pick)
- **What:** Add a `depth: fast | balanced | production` field to a task. Depth selects the *system
  prompt / skill instructions* injected into that task's SDK session and which post-run gates run.
  `production` = full clarify→plan→review→test pipeline; `fast` = implement+verify only.
- **Why:** Today every Nightcore task runs at one implicit rigor level. A depth dial lets a user run a
  cosmetic task cheaply and a payments task with full gates — the core of "production flow."
- **Effort:** M. **Lives:** Rust core (task model + per-task prompt assembly) + React web (depth
  picker on the card, defaulting via risk heuristics) + Bun sidecar (inject the depth-specific
  instruction block into the SDK `query`).
- **Constraints:** none — fully local, Claude-only compatible.

### 3.2 Auto-classify + risk-infer on task creation — from A/B
- **What:** When a task is created from a free-text goal, run the `/ship` intent table + risk-signal
  heuristic to suggest intent (CREATE/FIX/AUDIT/…) and a default depth, **shown to the user before the
  run** (never silent). High-risk + fast = surface the conflict.
- **Why:** Turns Nightcore's Backlog into a smart intake; encodes the "announce the plan, never hide
  the mode" invariant that builds user trust.
- **Effort:** M. **Lives:** Rust core (classifier as a deterministic rule table; optionally a cheap
  SDK call) + React web (the announce/confirm surface — maps onto your existing plan-approval UI).
- **Constraints:** none.

### 3.3 Gated post-run reviewer subagents — from D  ★ (highest leverage)
- **What:** After a task reaches a candidate state, dispatch the relevant **read-only reviewer
  subagents** (contracts, concurrency, data-integrity, security-regression, perf, …) against the
  worktree diff, **gated by what the diff touches**. Collect severity-ranked `file:line` findings into
  a structured panel on the card; `auto-fixable` items can be applied as a follow-up task, the rest
  surfaced for human decision before merge.
- **Why:** This is the missing **verification/quality-gate** layer between "Waiting Approval" and
  "Verified." It makes Nightcore's "Verified" column *mean* something. The subagents are already
  battle-tested prompt contracts you can adopt nearly verbatim — and Nightcore's worktree-per-task is
  the *ideal* substrate (clean diff boundary already exists).
- **Effort:** L (orchestrating N gated reviewers + a findings store + UI) / M if you start with 2–3
  reviewers (contracts + data-integrity + security-regression — the RECOMMEND.md top priorities).
- **Lives:** Rust core (reviewer scheduler, gate evaluation from `git diff --name-only`, findings
  persistence) + Bun sidecar (each reviewer is an SDK subagent run with Read/Grep/Bash tools) + React
  web (findings panel with severity + file:line + auto-fixable badges).
- **Constraints:** none — these are Claude subagents, local diffs. This is the single biggest
  production-flow upgrade available.

### 3.4 Pre-merge gauntlet — from G
- **What:** Before the "commit/merge worktree back to base" step, run a `check-pr-readiness`-style
  gate: detect the project's real `Cargo.toml`/`package.json` scripts, run typecheck→lint→test→
  residue-sweep against the worktree, **stop at first failure**, produce a READY/BLOCKED verdict that
  gates the merge button.
- **Why:** Right now a Verified task can merge without a mechanical quality gate. This is a local
  CI-substitute — exactly the "production-grade verification" Nightcore lacks.
- **Effort:** M. **Lives:** Rust core (tooling detection + sequential gate runner + verdict; this is
  natural Rust process-spawning work) + React web (verdict surface on the merge gate). Sidecar not
  needed — it's deterministic shell, not an agent task.
- **Constraints:** none.

### 3.5 Release-risk briefing on merge — from H
- **What:** When merging a worktree to base (or batch-merging Verified tasks), generate a
  HIGH/MEDIUM/LOW **content-risk briefing** (API/schema/auth/env/QA/doc/rollback categorizers) over
  the task's diff. Informational, shown at the merge boundary; never blocks.
- **Why:** Gives the single-user operator a "what could break / what to QA / how to roll back" summary
  at the exact moment of the irreversible step. Pure observability-of-change.
- **Effort:** S–M (mostly diff-categorizer logic). **Lives:** Rust core (diff categorizers) + React
  web (briefing panel). **Constraints:** none.

### 3.6 Context-isolated mapper subagents — from E
- **What:** Adopt the "scoped read-only agent returns a structured artifact" pattern for Nightcore's
  own investigation steps — e.g., a `runtime-contract-tracer` or `utility-finder` run *before* a task
  implements, feeding the plan. Keeps the main task session's context clean.
- **Why:** Improves task success rate and reduces token burn by front-loading structured codebase
  facts; directly strengthens the plan-approval gate's quality.
- **Effort:** M. **Lives:** Bun sidecar (subagent runs) + Rust core (optionally a pre-plan
  investigation phase in the task lifecycle). **Constraints:** none.

### 3.7 Reviewer/skill prompt library as a managed asset — from C/L
- **What:** Ship Nightcore with a curated, versioned library of skill-instruction blocks and reviewer
  prompts (the encoded `NEVER`/Instead/Why judgment), injectable per task by intent+depth. This is the
  content that makes `add-feature` rigorous.
- **Why:** Nightcore's quality ceiling is set by what it tells the SDK to do. Borrowing this encoded
  methodology is the cheapest way to raise output quality across every task.
- **Effort:** S to seed (adapt the Markdown), M to make it user-editable. **Lives:** Rust core
  (library storage + per-task assembly) + React web (a "skills/prompts" management view — note: this
  doubles as the **MCP/tool management UI** gap you listed). **Constraints:** none; keep it local.

### 3.8 Orchestration-graph integrity check — from K
- **What:** A CI/dev-time check that Nightcore's own task-dependency and skill-routing wiring is
  internally consistent (every declared dependency/route resolves), modeled on
  `check-skill-routing.mjs`.
- **Why:** As Nightcore grows skills/dependencies, a static consistency check prevents broken
  orchestration from shipping. Low-glory, high-durability.
- **Effort:** S. **Lives:** tooling (Rust test or a Bun script in CI). **Constraints:** none.

### 3.9 Fan-out doctrine for the auto-loop coordinator — from F
- **What:** Encode the "fan out only when truly independent; consolidate and resolve contradictions
  explicitly" doctrine into the coordinator's parallelization decisions and into any multi-subagent
  task. Nightcore already parallelizes N tasks via worktrees — extend the same discipline to
  *within-task* subagent fan-out.
- **Why:** Prevents the failure mode where parallel agents produce inconsistent contracts that cost
  more to reconcile than they saved.
- **Effort:** S (doctrine/guardrails in prompts + coordinator heuristics). **Lives:** Rust core
  (coordinator) + sidecar (subagent briefing templates). **Constraints:** none.

### 3.10 Multi-provider distribution seam — from M (note, low priority)
- **What:** AgentSystem's host-portability fallback ("if the Skill primitive is missing, read the file
  and run inline, and surface the degradation") is a model for Nightcore's existing
  Codex/other-provider seam.
- **Why / flag:** Useful *only if/when* Nightcore lifts its Claude-only constraint. **Conflicts with
  the current Claude-only, single-user posture** — park it. Listed for completeness, not for now.

### Constraint summary
Nothing in 3.1–3.9 conflicts with local-first / Claude-only / single-user. The only flagged conflict is
3.10 (multi-provider), which is explicitly out of scope today. Cloud/CI/multi-user features are *not*
what AgentSystem offers anyway — it is itself local and agent-first, which is why the fit is clean.

---

## 4. Top 5 highest-leverage borrowings (ranked)

1. **Gated post-run reviewer subagent fleet (3.3 / pattern D).** The biggest production-flow upgrade.
   Turns "Verified" into a real quality bar, exploits Nightcore's worktree diffs perfectly, and the
   prompt contracts (severity-ranked, file:line both sides, `auto-fixable` flag, gated firing) are
   adoptable nearly verbatim. Start with contracts + data-integrity + security-regression.

2. **Per-task depth modes (3.1 / pattern B).** A single dial that makes Nightcore right-size rigor
   per task — the conceptual heart of "production flow." Cheap relative to its impact and unlocks the
   gating logic everything else hangs off.

3. **Pre-merge readiness gauntlet (3.4 / pattern G).** A deterministic, tooling-aware local
   CI-substitute that gates the irreversible merge — closes the "Verified can merge unchecked" hole.
   Natural Rust work, no agent cost.

4. **Auto-classify + announce-the-plan intake (3.2 / pattern A).** Smart Backlog intake plus the
   "never hide the mode, surface high-risk conflicts" trust invariant — folds straight into the
   existing plan-approval UI.

5. **Release-risk briefing at merge (3.5 / pattern H).** High-value, low-effort observability-of-change
   at the exact moment it matters for a solo operator; informational so it never fights the user.

(Runners-up worth tracking: the mapper-subagent context-isolation pattern (3.6) and the encoded
NEVER/Instead/Why skill library (3.7) — both quietly raise per-task quality across the board.)
