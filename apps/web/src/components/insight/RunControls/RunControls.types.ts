import type { AnalysisScope, FindingCategory } from '@/lib/bridge';

/** Values used to pre-fill the form on "New run" (from the last/loaded run). */
export interface RunConfigPrefill {
  scope?: AnalysisScope | null;
  model?: string | null;
  categories?: FindingCategory[];
}

/**
 * The lifted run-configuration form state. It lives ABOVE `RunControls` (in the
 * InsightView hook, via `useRunConfig`) so it survives the CONFIGURE → RUNNING →
 * RESULTS phase swaps and pre-fills when the user starts a new run. `RunControls`
 * is now a controlled, purely-presentational form that renders this.
 */
export interface RunConfigState {
  scope: AnalysisScope;
  setScope: (scope: AnalysisScope) => void;
  model: string | null;
  setModel: (model: string | null) => void;
  effort: string | null;
  setEffort: (effort: string | null) => void;
  /** The currently-selected category set (membership test for chips). */
  selected: Set<FindingCategory>;
  /** Toggle one category in/out of the selected set. */
  toggle: (category: FindingCategory) => void;
  /** Select every category. */
  selectAll: () => void;
  /** Clear the selection. */
  selectNone: () => void;
  /** Pre-fill the form from a prior run (used by "New run" / "Retry"). */
  prefill: (opts: RunConfigPrefill) => void;
  /** The selected categories in canonical display order (sent on Analyze). */
  orderedSelected: FindingCategory[];
  /** Whether the Analyze action is currently permitted. */
  canAnalyze: boolean;
}

export interface RunControlsProps {
  /** The lifted form state, owned by the InsightView hook. */
  config: RunConfigState;
  /** True between the Analyze click and the optimistic running swap. */
  isStarting: boolean;
  /** Start a run with the current config. */
  onAnalyze: () => void;
}
