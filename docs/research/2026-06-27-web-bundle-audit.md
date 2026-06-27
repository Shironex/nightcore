# Web Bundle Audit — apps/web

**Date:** 2026-06-27
**Agent:** kirei-bundle
**Scope:** apps/web production client bundle (full output)
**Bundler:** Vite 7 + @vitejs/plugin-react + @tailwindcss/vite
**App shape:** SPA embedded in Tauri (relative `base: './'`, custom protocol)

## Summary

Total client JS shipped: **~1.72 MB raw / ~497 KB gzip** across 21 JS chunks (plus 62 KB / 11 KB-gz CSS and ~147 KB of woff2 fonts).

The Vite "chunk > 500 kB" warning is fired by exactly two chunks:

- `CodeBlock-*.js` — **992.6 KB raw / 133.3 KB gzip** (Shiki + 7 grammars). Already an isolated, lazy-loaded chunk. Never on first paint.
- `index-*.js` (entry) — **464.1 KB raw / 139.8 KB gzip**. This is the only first-paint chunk and the real lever.

The codebase is already well code-split: six route surfaces (Projects, Settings, Insight, Scorecard, Harness, TaskDetail) are `React.lazy` behind `<Suspense>` in `AppShell.tsx`, and Shiki (`CodeBlock`) and the markdown renderer (`marked`+`dompurify`) are each their own async chunk. The classic "raise the warning limit" anti-fix has NOT been applied — `chunkSizeWarningLimit` is untouched.

So this is not a "everything is in one blob" situation. The remaining wins are narrower:

1. **Trim the Shiki grammar payload** — biggest raw-byte win (~600 KB raw / ~80 KB gzip), but only affects code-viewing routes, not first paint.
2. **Move the board's interaction libs (@dnd-kit + @tanstack/react-virtual, ~47 KB raw / ~15 KB gzip) out of the eager entry** — modest first-paint win, medium effort.
3. **Add a `manualChunks` vendor split** so React/zod cache independently of app code — caching win, not a size win.
4. **Silence the warning honestly** by raising `chunkSizeWarningLimit` to ~1000 *after* the Shiki trim, since the lazy CodeBlock chunk is legitimately large and download-deferred.

## Measurement (before-state)

| Chunk | Raw | Gzip | Role |
|---|---|---|---|
| `CodeBlock-B9oWO-Fu.js` | 992.6 KB | 133.3 KB | async — Shiki highlighter (insight/harness/settings) |
| `index-ByWkl_V2.js` | 464.1 KB | 139.8 KB | **entry / first paint** |
| `Markdown-CpK1UE4Y.js` | 67.7 KB | 22.9 KB | async — marked + dompurify |
| `index-CpeUoYpf.js` | 38.7 KB | 9.8 KB | async route view |
| `index-DqzFVurO.js` | 37.1 KB | 10.2 KB | async route view |
| `index-CYD92TLw.js` | 30.6 KB | 8.8 KB | async route view |
| `index-BqbPLzyA.js` | 26.1 KB | 8.0 KB | async route view |
| `index-BCexY1hq.js` | 19.7 KB | 6.0 KB | async route view |
| `useRunConfig-Df9UnSvR.js` | 6.7 KB | 2.4 KB | shared run-config hook |
| `index-DckGNKZV.js` | 6.2 KB | 2.4 KB | shared |
| `Menu-*` / icon chunks | < 2.3 KB each | — | lucide icon leaf chunks |
| `index-ByWxeqR3.css` | 62.0 KB | 10.7 KB | Tailwind CSS |
| woff2 fonts (4) | ~147 KB total | (pre-compressed) | DM Sans + JetBrains Mono |

**First-paint download (entry JS + CSS, gzip): ~150 KB.** That is already healthy. The 1 MB the warning complains about is the deferred Shiki chunk, not what users download on load.

### Entry chunk composition (sourcemap attribution, % of raw)

| Package / group | % of entry | ~raw | Notes |
|---|---|---|---|
| `react-dom` | 39.2% | 181 KB | unavoidable runtime |
| app source (`src/`) | 23.2% | 107 KB | board + app shell + ui + lib |
| **`zod`** | **15.5%** | **72 KB** | runtime validation via `@nightcore/contracts` |
| `@dnd-kit/core` | 8.3% | 38 KB | board drag-and-drop |
| `@tanstack/virtual-core` | 4.8% | 22 KB | board column virtualization |
| workspace pkgs (contracts/session-fold) | 2.7% | 13 KB | mostly the zod schema definitions |
| `lucide-react` | 2.0% | 9 KB | icons (tree-shaken to used set) |
| `react` | 2.0% | 9 KB | runtime |
| `scheduler`, `@dnd-kit/utilities`, `@tanstack/react-virtual`, `@tauri-apps/*` | remainder | small | — |

### CodeBlock chunk composition

| Package | % | ~raw |
|---|---|---|
| `@shikijs/langs` (7 grammars) | 82.1% | 813 KB |
| `@shikijs/vscode-textmate` | 4.3% | 43 KB |
| `oniguruma-to-es` + `oniguruma-parser` | 4.9% | 49 KB |
| `@shikijs/core/themes/primitive` + hast utils | ~8% | rest |

Already using the fine-grained `shiki/core` entry with the JS regex engine (no oniguruma WASM) and only 7 langs — a deliberate optimization (see `CodeBlock.hooks.ts` header comment). The remaining bulk is the grammar JSON itself.

## Findings

### HIGH — Shiki grammar payload dominates the lazy CodeBlock chunk *(saves ~550–650 KB raw / ~75–85 KB gzip on the code-viewing routes)*
**Type:** Heavy dep (deferred, not first-paint)
**Location:** `src/components/ui/CodeBlock/CodeBlock.hooks.ts:5-11,22`
**Current weight:** `@shikijs/langs` = 813 KB raw inside a 993 KB / 133 KB-gz async chunk.
**Why it's big:** 7 full TextMate grammars are statically imported and eagerly bundled into the highlighter singleton. `tsx`/`typescript`/`jsx`/`javascript` grammars are individually huge and overlapping.
**Fix options (pick per appetite):**
- **Cheapest:** drop rarely-needed grammars. Audit what actually gets highlighted in Insight/Harness/Settings output. If most rendered code is TS/TSX/bash/json, dropping `javascript`+`jsx` (covered visually well enough by `tsx`/`typescript`) and `markdown` trims a large share. Each removed lang is ~50–150 KB raw.
- **Better:** lazy-load grammars on demand instead of all 7 up front — change `LANGS` from static imports to `await import('shiki/langs/<id>.mjs')` inside `getHighlighter()` keyed by the languages actually requested. Shiki's `createHighlighterCore` supports dynamic `loadLanguage`. This moves grammars behind first *use of that language*, so a JSON-only screen never pays for the tsx grammar.
- **Note:** this does NOT affect first paint (CodeBlock is already async). It improves the insight/harness/settings open latency and total transfer, not initial load.
**Estimated saving:** ~75–85 KB gzip off the CodeBlock chunk with on-demand grammar loading; ~30–50 KB gzip with a simple grammar prune.

### MEDIUM — Board interaction libs are eagerly bundled in the first-paint entry *(saves ~47 KB raw / ~15 KB gzip off the entry)*
**Type:** Missing split
**Location:** `src/components/app/AppShell/AppShell.tsx:2` imports `Board` eagerly; `@dnd-kit/core` (38 KB) + `@tanstack/virtual-core` (22 KB) ride along.
**Current weight:** ~47 KB raw / ~15 KB gzip of the 140 KB-gz entry.
**Constraint:** the Board *is* the primary first-paint surface once a project is active, so naively lazy-loading `Board` only helps the Projects-landing first paint (which is itself common — the app lands on full-screen Projects when no project is active, per `AppShell.tsx:95`).
**Fix:** Lazy-load `Board` the same way the other surfaces already are:
```ts
const Board = lazy(() => import('@/components/board').then((m) => ({ default: m.Board })));
```
and wrap its render site (`AppShell.tsx:167`) in the existing `<Suspense fallback={<RouteFallback/>}>`. `@dnd-kit` + `@tanstack/react-virtual` then split into the board chunk. First paint on the Projects landing drops ~15 KB gzip; opening a board pays it once (cached).
**Estimated saving:** ~15 KB gzip off entry / first paint for the (common) no-active-project landing. Low effort, mirrors existing pattern.

### MEDIUM — No vendor `manualChunks`; React + zod re-download on every app-code change *(caching win, ~0 size change)*
**Type:** Missing split / cache strategy
**Location:** `apps/web/vite.config.ts` `build` block (no `rollupOptions.output.manualChunks`).
**Current state:** react-dom (181 KB) + react (9 KB) + zod (72 KB) are inlined into the entry alongside app source. Any app-code edit busts the hash on the entire 464 KB entry, forcing a full re-download even though the vendor halves are stable across releases.
**Fix:** add a stable vendor split:
```ts
build: {
  target: 'es2022',
  rollupOptions: {
    output: {
      manualChunks: {
        'react-vendor': ['react', 'react-dom', 'scheduler'],
        'zod-vendor': ['zod'],
      },
    },
  },
},
```
This does not reduce total bytes (slightly increases due to chunk boundaries), but ~190 KB of react + 72 KB of zod become long-lived cached chunks — meaningful for a desktop app that ships frequent web updates inside Tauri.
**Estimated saving:** 0 KB first-install; ~130 KB gzip avoided on every *subsequent* app-code update.

### MEDIUM — zod runtime validation is 15.5% of the entry; keep, but worth knowing *(no easy saving)*
**Type:** Heavy dep (legitimate first-paint use)
**Location:** `src/lib/bridge.ts` — `NightcoreEventSchema.safeParse(...)` validates every inbound wire event (`bridge.ts:356,760,1027,1137,1305`), plus `QuestionItemSchema`.
**Current weight:** ~72 KB raw / ~20 KB gzip in entry.
**Assessment:** This is real runtime validation on the event hot path (first-paint, since event listeners attach at boot), so it cannot be lazy-loaded without weakening the C3 wire-validation guarantee. zod v4 is already tree-shaken to the used schema graph. Two long-term options, both larger refactors — flag for consideration, not a quick win:
- Validate only at the trust boundary you actually need (e.g., gate `safeParse` behind a dev/debug flag and trust the Rust-side contract in production, since the contracts are codegen'd both ways). Risky — removes a defensive layer.
- Move to a lighter validator (valibot, ~1/10th the size) — but that's a contracts-package migration touching the codegen pipeline. Out of scope for a bundle pass; route via `/kirei migrate` if pursued.
**Estimated saving:** ~18 KB gzip if zod validation were removed/replaced — but high blast radius. Not recommended as a quick win.

### LOW — Vite chunk-size warning should be raised *after* the Shiki trim, not before *(no size change; removes noise)*
**Type:** Build config
**Location:** `apps/web/vite.config.ts`
**Assessment:** The warning is currently *correct* — the CodeBlock chunk really is ~1 MB raw. Raising `chunkSizeWarningLimit` now would mask the legitimate Shiki-grammar issue (the anti-fix the user worried about). After the HIGH item lands and CodeBlock drops well under the threshold, the only remaining flagged chunk should disappear. If a residual lazy chunk stays near the limit, set `build.chunkSizeWarningLimit: 700` *with a comment explaining it covers the deferred Shiki chunk* — honest, not a cover-up.

### LOW — Fonts: 4 woff2 files, ~147 KB *(already optimal format)*
**Type:** Asset
**Location:** `dist/assets/*.woff2` (DM Sans + JetBrains Mono, latin + latin-ext subsets).
**Assessment:** Already woff2 (best format), already subsetted (latin / latin-ext split). The latin-ext subsets (15 KB + 18 KB) only load if extended-latin glyphs are rendered. No action needed unless extended-latin is never used in this desktop app, in which case dropping the two `-ext` subsets saves ~33 KB of conditionally-loaded font — verify before removing.

## Quick Wins (< 1 hour each)
- **Lazy-load `Board`** — `AppShell.tsx:2` + render site `:167` — saves ~15 KB gzip off the Projects-landing first paint. Mirrors the six existing lazy routes.
- **Add `manualChunks` vendor split** — `vite.config.ts` — caching win, ~130 KB gzip avoided per subsequent update.
- **Prune unused Shiki grammars** — `CodeBlock.hooks.ts:5-11,22` — saves ~30–50 KB gzip off the (deferred) CodeBlock chunk depending on which langs are actually rendered.

## Heavy Lifts (> 1 day)
- **On-demand Shiki grammar loading** (`createHighlighterCore` + dynamic `loadLanguage`) — biggest raw-byte reduction (~75–85 KB gzip off CodeBlock) but requires reworking the singleton highlighter lifecycle and async language resolution in `CodeBlock.hooks.ts` + handling the "grammar not yet loaded" render state. Affects deferred routes only.
- **zod → valibot migration** in `@nightcore/contracts` — ~18 KB gzip off entry but touches the dual codegen pipeline (zod→Rust generated.rs). Out of scope for bundle; route to `/kirei migrate`.

## Budget Recommendation
The app has no `size-limit`/`bundlesize` config. Suggested budgets, gzip:
- **Entry chunk (first paint JS): ≤ 140 KB gzip** — currently 139.8 KB; effectively at the line. Lazy-loading Board buys headroom.
- **First-paint total (entry JS + CSS): ≤ 170 KB gzip** — currently ~150 KB. Healthy.
- **Any single deferred chunk: ≤ 100 KB gzip** — CodeBlock currently breaches at 133 KB; the Shiki work brings it under.
Wire one of these via `size-limit` in CI so regressions surface on PR.

## Verification
1. `bun run --filter @nightcore/web build` and compare the printed table against the Measurement section above.
2. After lazy-loading Board: confirm the entry chunk gzip drops by ~15 KB and a new board chunk appears.
3. After Shiki work: confirm `CodeBlock-*.js` gzip falls under 100 KB and the ">500 kB" warning no longer fires.
4. Runtime: open Insight/Harness with the Network tab — confirm the CodeBlock chunk (and, if on-demand grammars land, individual `langs/*` chunks) load only when code is rendered, not at boot.
