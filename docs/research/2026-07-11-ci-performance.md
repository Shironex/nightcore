# Nightcore CI Performance Analysis (map #141)

**Date:** 2026-07-11 · **Repo:** Shironex/nightcore · **Data:** 120 CI runs (2026-07-06 → 07-11), 60 audit runs, per-job breakdown of 45 CI runs + 20 audit runs + 9 long-tail runs.

---

## 1. Workflow topology

Three workflows in `.github/workflows/`:

| Workflow | Trigger | Jobs | Runner(s) | Concurrency | Path filter |
|---|---|---|---|---|---|
| `ci.yml` | push→main, PR, dispatch | 4 (macos-sandbox, bun-checks, web-coverage, rust-checks) | ubuntu-latest ×3 + macos-latest ×1 | group per-ref, cancel-in-progress (main keyed on run_id so never cancels) | **none** |
| `audit.yml` | push→main, PR, weekly cron, dispatch | 2 (bun-audit, cargo-audit) | ubuntu-latest ×2 | none | **none** |
| `release.yml` | tag `v*.*.*`, dispatch | publish-tauri matrix ×3 (mac arm64, mac x64, win) | macos-latest ×2 + windows-latest | none | tag-only |

**Merge gate (ruleset `main`, id 18540756, enforcement active).** All 6 checks across BOTH ci.yml and audit.yml are **required**:
- vitest browser coverage (apps/web)
- cargo test · clippy · fmt · ts-rs drift (Rust core)
- lint · typecheck · test (Bun workspace)
- seatbelt containment (macOS engine tests)
- bun audit (Bun workspace)
- cargo audit (Rust crate)

`strict_required_status_checks_policy: false` — PRs do **not** need to be up-to-date with main to merge (no "update branch → re-run" churn; merge-skew is possible but accepted). Also enforced: `deletion`, `non_fast_forward`. No merge queue.

**Caching present today:**
- Rust: `Swatinem/rust-cache@v2` on `apps/desktop/src-tauri` ✅
- Playwright chromium binary: `actions/cache@v4` keyed on `bun.lock` (≈95% hit — cache-miss install seen in only 2/45 runs) ✅
- Vite/Vitest dep-optimize cache: `actions/cache@v4` on `apps/web/node_modules/.vite` ✅
- **No** bun/node_modules cache (setup-bun default; `bun install` is only 3–6s so not a bottleneck)
- **No** apt-package cache (Tauri GTK deps + Playwright system libs reinstalled from the mirror every run — this is the #1 flake source, see §4)

---

## 2. Measured timing table

Per-**job** execution time (`started_at` → `completed_at`), n=45 CI runs + n=20 audit runs. Queue time is negligible across the board (median 3–4s, max 5s — public repo has ample runner capacity).

| Check (required) | Median | p90 | Max | % of critical path | Notes |
|---|---:|---:|---:|---:|---|
| **vitest browser coverage (apps/web)** | **216s** | **233s** | 514s | **100% (CRITICAL PATH)** | gates every merge |
| cargo test · clippy · fmt · ts-rs (Rust) | 145s | 176s | 206s (557s w/ apt flake) | 67% | not on critical path unless apt flakes |
| lint · typecheck · test (Bun) | 37s | 39s | 43s | 17% | |
| seatbelt containment (macOS engine) | 22s | 27s | 31s | 10% | macos-latest, billed 10× but only 22s |
| cargo audit (Rust crate) | 18s | 20s | 21s | 8% | separate workflow, parallel |
| bun audit (Bun workspace) | 10s | 15s | 16s | 5% | separate workflow, parallel |

**Merge-gate wall-clock = max(all 6, all parallel) ≈ web-coverage.** Median ~216s (3.6 min), p90 ~233s (3.9 min). Workflow-level `createdAt→updatedAt` median was 201s / p90 249s / max 872s — consistent (the 872s max is an apt-mirror flake, §4).

### Critical-path job — step breakdown (web-coverage, median 216s)

| Step | Median | p90 | On critical path? | Reducible? |
|---|---:|---:|---|---|
| `bun run test:web:coverage` (browser suite + istanbul floor) | 158s | 167s | yes | only via sharding (don't weaken floor) |
| `bunx tsc -b apps/web` (build @nightcore/* dep chain) | 15s | 16s | yes | partial (prebuilt dep artifact) |
| `Free runner disk space` (rm dotnet/CodeQL, anti-ENOSPC) | 14s | 17s | yes | conditional/parallel |
| `Install Playwright system deps` (apt, **runs on cache-hit too**) | 14s | 21s | yes | **apt cache** (flakes to 315–330s) |
| `bun install --frozen-lockfile` | 3s | 5s | yes | no |
| Playwright chromium download (cache-miss only, 2/45) | 12s | — | occasional | already cached |
| checkout / setup-bun / cache restore / posts | ~8s | | yes | no |

**Overhead beyond the actual browser suite ≈ 45–58s** (tsc 15 + disk 14 + playwright-deps 14 + install/misc ~15).

### Rust job — step breakdown (median 145s; not critical path but largest compute)

| Step | Median | p90 | Notes |
|---|---:|---:|---|
| `bun run test:rust` (compile sidecar externalBin + cargo test + ts-rs regen) | 53s | 55s | 163s on **cold** cargo cache (run 28945759753) |
| `Install Tauri system dependencies` (apt: webkit2gtk, gtk3, etc.) | 27s | 42s | **not cached**, flakes to 350–439s |
| `Swatinem/rust-cache@v2` restore | 22s | 39s | |
| `cargo clippy -D warnings` | 22s | 24s | |
| `dtolnay/rust-toolchain` | 9s | 9s | |
| `cargo fmt --check`, ts-rs diff assert, bun install | ~4s | | |

The ~62MB Bun-compiled sidecar is built **exactly once** (rust-checks `test:rust`); web-coverage and macos-sandbox never build it (they only `tsc -b` the TS dep chain). **No redundant sidecar builds across jobs** — this is already correct.

---

## 3. Daily cost / latency framing

- **Merge-gate wall-clock per PR** ≈ web-coverage: **216s median / 233s p90** (best-case ~4 min as the maintainer observed; 8.5–14.5 min when apt-mirror flakes hit).
- **Serial merge of 15–20 PRs/day** waiting on the slowest check:
  - 15 PRs × 216s ≈ **54 min/day**; × 233s p90 ≈ 58 min/day
  - 20 PRs × 216s ≈ **72 min/day**; × 233s p90 ≈ 78 min/day
  - Real figure is higher because ~4–5 runs/day catch the apt-mirror tail (500–870s).
- **Compute per full battery** (all 6 jobs, real seconds): 448s ≈ **7.5 runner-min** (of which macOS 22s → 3.7 equiv-min at 10× billing).
- **Per merged PR ≥ 2 full batteries** (the PR-event run + the post-merge push-to-main run, plus any intermediate PR pushes) ≈ **15 runner-min**, → **~225–300 runner-min/day** of compute.
- **Billing:** public repo ⇒ GitHub-hosted minutes are **free**. Optimize for **human wall-clock waiting** (~1–1.3 hr/day) and flake elimination, not $.

---

## 4. Flake register (with signatures)

| # | Flake | Signature (grep the job log) | Frequency | Impact | Root cause |
|---|---|---|---|---|---|
| F1 | **Slow apt mirror — Playwright system deps** | step `Install Playwright system deps` jumps from 14s → **315–330s** (runs 29132866823, 29135189019); web-coverage job 513–514s | ~2–3/day | +5 min on the **critical path**, still passes | Azure apt mirror slow-fetching Playwright fonts/libs; installed fresh every run (no apt cache) |
| F2 | **Slow apt mirror — Tauri GTK deps** | step `Install Tauri system dependencies` 27s → **350–439s** (runs 29099876524, 29122652487); rust job 455–557s | ~2/day | rust job **becomes** the critical path (557s > web) | same slow-mirror class, webkit2gtk/gtk3 fetched fresh every run |
| F3 | **Vite dep-optimize reload freeze** | `Failed to fetch dynamically imported module: .../node_modules/.cache/storybook/.../sb-vitest/deps/react-18-*.js` → storybook stories fail; run 29028761138 failed at ~432s | 1 confirmed in window (→ red) | false-red requiring a rerun | a Storybook story triggers mid-run re-optimization of `react-18`; the `react-dom/client` pre-bundle (vitest.config.ts) doesn't cover the sb-vitest `react-18` shim. The 7-min step timeout turns the hang into a red instead of a 35-min burn (guard working) |
| F4 | **ENOSPC on ubuntu VM** | `no space left on device` mid-suite (historical run 28756795439, pre-fix) | rare (mitigated) | job dies ~70% through | preinstalled toolchains eat headroom; mitigated by the `Free runner disk space` step (rm dotnet/CodeQL) |
| F5 | **secret_scan ETXTBSY** (task-listed) | n/a | **not reproducible** | — | **No `secret_scan` job exists** in any current workflow — this is a local commit-gate/historical flake, not CI. Flagged as stale. |

**Reruns:** 1 run in the 45-sample had `run_attempt=2` (29134007304). **Failures:** 16/120 CI runs — most are *real* reds (e.g. 29133960431 = `CHANNELS registry rename tripwire` contract-drift test failing; several push-to-main compile/lint reds). Only F3 was a confirmed flake-red in-window; F1/F2 pass slowly rather than fail. **True flake-red rate ≈ 1–2%**; **slow-tail rate (F1/F2) ≈ 4–5 runs/day**.

---

## 5. Waste inventory

1. **apt reinstalled from the mirror every run, uncached** — the single largest lever. Hits BOTH the critical path (Playwright deps, 14s→330s) and the rust job (Tauri deps, 27s→439s). This is the root of F1+F2.
2. **Doc-only commits run the full battery.** 16/120 CI runs (13%) had `docs*`-prefixed titles (docs/research/*.md is committed very frequently here). No `paths`/`paths-ignore` filter anywhere. A pure-`docs/**`+root-`*.md` change cannot affect the rust/web/lint/coverage/audit gates — yet each runs a full 7.5-runner-min battery and a ~3.6 min human wait.
3. **`Free runner disk space` (14s) sits on the critical path** on every web-coverage run to defend against a rare ENOSPC (F4).
4. **`Install Playwright system deps` runs on cache-hit too** (14s) — the browser binary is cached but the apt libs are re-fetched every run.
5. **Post-merge main CI re-runs the full battery** for a commit already validated on the PR (strict policy is off, so no pre-merge re-run, but the post-merge push still runs). ~half of daily compute.
6. **No merge queue** — the maintainer serially waits on each PR's slowest check by hand.

**Already-good (leave alone):** concurrency cancellation for superseded PR pushes (with the main-keeps-per-commit exception) is correctly configured; sidecar compiled once; rust-cache + playwright + vite caches present; audit jobs are cheap (10–18s, no compilation) and parallel; queue time ~0; macOS job scoped tight (22s) despite 10× billing.

---

## 6. Ranked improvement proposals

Integrity rule honored: **no gate's coverage is weakened** — every proposal keeps identical checks running on identical inputs, or skips only inputs that provably cannot affect a gate.

### Quick wins

**QW1 — Cache apt packages (Tauri GTK + Playwright system libs).** *[attacks F1+F2]*
- What: add `awalsh128/cache-apt-pkgs-action` (or cache `/var/cache/apt/archives`) for the Tauri deps in rust-checks and the Playwright `install-deps` in web-coverage. Removes the live-mirror dependency.
- Saving: warm ~14s (web critical path) + ~27s (rust); **eliminates the 300–440s flake tail** on ~4–5 runs/day. Per-day: removes ~20–35 min of tail-latency + shaves ~14s×(PRs) off the critical path.
- Gate integrity: none — identical packages installed. Effort: **S**.

**QW2 — Don't re-run `playwright install-deps` on cache-hit.** *[shrinks critical path]*
- What: the browser binary is cached; audit whether the system libs are already present on ubuntu-latest and drop/guard the `install-deps` step (or fold it into QW1's apt cache).
- Saving: ~14s/run on the critical path × 15–20 PRs ≈ 3.5–5 min/day. Gate integrity: none. Effort: **S** (needs one verification run that chromium still launches).

**QW3 — Move/condition `Free runner disk space`.** *[shrinks critical path]*
- What: run the dotnet/CodeQL rm only when free space is low, or overlap it (it's independent of checkout). Currently 14s unconditional.
- Saving: ~14s/run × PRs ≈ 3.5–5 min/day. Gate integrity: none (ENOSPC guard preserved as conditional). Effort: **S**.

**QW4 — Pre-bundle the Storybook `react-18` shim in vitest optimizeDeps.** *[kills F3]*
- What: add the sb-vitest `react-18` dep to `optimizeDeps.include` (alongside the existing `react-dom/client` entry) in vitest.config.ts / .storybook/main.ts so it's never re-optimized mid-run.
- Saving: removes the confirmed dep-optimize false-red (≥1 rerun/window; each costs a full ~4-min re-run + human attention). Gate integrity: none (same tests run). Effort: **S**.

### Structural changes

**S1 — Path-filter pure-docs changes off the heavy jobs.** *[biggest compute + doc-PR latency win]*
- What: docs/research/*.md is committed constantly (13% of runs). Because the 6 checks are **required**, you cannot use `paths-ignore` at the trigger (a required check that never runs blocks the merge forever). Safe pattern: keep the jobs in the matrix so the required check names always resolve, but gate their expensive steps behind a `dorny/paths-filter` (or a `git diff --name-only` step) that short-circuits to a green no-op when the diff touches **only** `docs/**` and root `*.md`. Conservative: ANY non-docs path → full battery.
- Saving: 13% of runs skip ~216s web + ~145s rust + ~37s lint compute; doc PRs merge in seconds instead of 3.6 min. ~2–3 doc pushes/day → ~10 min/day human wait + ~20–30 runner-min/day compute.
- Gate integrity: **preserved** — the filter is provably safe (a `docs/**`/`*.md`-only diff cannot change Rust, TS, coverage, or lockfiles). Risk is *plumbing* (required-check must still report green) and *misclassification* (mitigate: strict allowlist, fail-closed to full battery on any non-docs path). Honestly assessed: this is the one proposal that touches gate *triggering*, so it needs a careful reviewer and a test PR — but it does not weaken any gate's *coverage*. Effort: **M**.

**S2 — Shard the browser suite across 2 parallel jobs.** *[biggest critical-path win]*
- What: `vitest --shard=1/2` and `2/2` in two parallel web-coverage jobs; merge istanbul coverage across shards **before** applying the floor (so the coverage gate stays exact).
- Saving: `test:web:coverage` 158s → ~80s/shard in parallel → web-coverage critical path ~216s → **~140s** (−35%). Per-day: ~15 PRs × ~76s ≈ **19 min/day**; 20 PRs ≈ 25 min/day.
- Gate integrity: **preserved only if coverage reports are merged before thresholding** — this is the correctness-critical detail; a naive per-shard floor would weaken the gate. Also both shard checks must be required. Effort: **M–L**.

**S3 — Adopt GitHub merge queue.** *[optimizes the human-waiting metric directly]*
- What: enable merge queue on the `main` ruleset. The maintainer queues PRs instead of babysitting each check; the queue runs CI against the projected merged state (also *gains* merge-skew detection that strict-policy-off currently lacks).
- Saving: converts ~1–1.3 hr/day of serial human waiting into fire-and-forget queueing. Wall-clock for the human ≈ 0; compute unchanged (still one battery per entry).
- Gate integrity: **strengthened** (catches merge-skew). Trade-off: adds per-entry queue latency; needs the flake tail (F1–F3) fixed first or the queue stalls. Effort: **M** (config + sequencing after QW1/QW4).

**S4 — Trim redundant post-merge main CI (optional, only with S3).** 
- What: post-merge main push re-runs the full battery for an already-validated commit (~half of daily compute). With a merge queue (S3) validating the merged state, the post-merge main run becomes largely redundant and can be reduced.
- Saving: up to ~half of the ~225–300 runner-min/day compute (compute only; public repo = free, so low priority).
- Gate integrity: safe **only** under S3 (merge queue provides the merged-state validation). Without S3, keep it — it's the only merge-skew catcher. Effort: **M**.

### Quick-wins vs structural split

| Quick wins (ship first, low risk) | Structural (plan, needs review) |
|---|---|
| QW1 apt cache (kills F1+F2) | S1 docs path-filter (compute + doc-PR latency) |
| QW2 skip playwright install-deps on cache-hit | S2 shard browser suite (−35% critical path) |
| QW3 condition disk-free step | S3 merge queue (human-wait → ~0) |
| QW4 pre-bundle react-18 shim (kills F3) | S4 trim post-merge main CI (only with S3) |

**Recommended order:** QW1 + QW4 first (kill the flake tail — prerequisite for S3), then QW2/QW3 (shave the critical path), then S2 (structural critical-path cut), then S1 (docs), then S3+S4 (merge queue) once flakes are gone.

**Combined critical-path estimate:** QW2+QW3 (−28s) + S2 (−76s) takes web-coverage from ~216s to **~112s** (−48%), i.e. ~54–72 min/day → **~28–37 min/day** human wait, with the F1/F2/F3 spikes eliminated by QW1+QW4.

---

## 7. What I could NOT measure (and why)

- **GitHub Actions minute billing / $ cost** — public repo ⇒ hosted minutes free; reported runner-minutes as the compute proxy instead.
- **Whether the maintainer waits on the post-merge main run before merging the next PR** — this is behavioral, not in the API. If they do, the daily wall-clock figures roughly double. Assumed they gate on the PR-event checks only.
- **Cold-vs-warm cargo cache hit rate over time** — inferred from `test:rust` timings (48–55s warm vs 163s cold, cold seen ~1/45) rather than cache-action hit logs (not exposed in the jobs API).
- **Exact per-PR count of full-battery re-runs** — depends on how many pushes each PR received; estimated ≥2 (PR + post-merge) as a floor.
- **F4 ENOSPC live frequency** — mitigated before the sampling window; evidenced only by the workflow comment + historical run 28756795439, not reproduced in the 120-run window.
- **F5 secret_scan ETXTBSY** — no such job in current workflows; could not locate or reproduce (flagged stale/local).
- **Logs older than GitHub's retention** — the 872s workflow-max and some older failures had expired step logs; characterized those from job/step timestamps only.
