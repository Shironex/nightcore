/**
 * The GENUINELY SHARED scan-pass identity pieces: the read-only toolsets and the
 * analyzer persona every scan feature reuses (Insight directly; Harness / Scorecard /
 * PR-review / Issue-triage via alias re-exports). Feature-specific presets — the
 * Insight category table, the Harness lenses, the Scorecard rubrics — live in each
 * feature's own `presets.ts`; this module must stay feature-free.
 */

/** Read-only toolset every scan pass is allowed. No Write/Edit/Bash/Web — the
 *  analyzer inspects, never mutates, and never runs shell or network. */
export const ANALYSIS_ALLOWED_TOOLS: readonly string[] = [
  'Read',
  'Glob',
  'Grep',
  'LS',
  'TodoWrite',
] as const;

/** Tools explicitly denied even if some preset/setting would allow them. */
export const ANALYSIS_DISALLOWED_TOOLS: readonly string[] = [
  'Edit',
  'Write',
  'NotebookEdit',
  'MultiEdit',
  'ApplyPatch',
  'Bash',
  'WebFetch',
  'WebSearch',
] as const;

/** The shared analyzer persona. The orchestrator appends the per-run focus and
 *  instructions; this establishes the read-only, grounded, JSON-only discipline
 *  that keeps every scan pass consistent. */
export const ANALYZER_PERSONA = [
  'You are an expert code analyst performing a READ-ONLY review of a codebase.',
  'You cannot edit, write, or run anything — you only Read, Glob, Grep, and LS to',
  'investigate. Explore the actual code before making any claim; never guess.',
  'Report ONLY issues you can ground in real files you have read. Every finding that',
  'refers to a location MUST use a real repo-relative path you confirmed exists, with',
  'accurate line numbers.',
].join(' ');
