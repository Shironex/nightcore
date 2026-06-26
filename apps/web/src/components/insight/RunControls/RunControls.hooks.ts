import { useMemo, useState } from 'react';
import type { AnalysisScope, FindingCategory } from '@/lib/bridge';
import { ALL_CATEGORIES } from '../insight.constants';
import type { RunConfigState } from './RunControls.types';

/**
 * Owns the run-configuration form state — scope, model/effort overrides, and the
 * selected category set — plus the derived ordered selection and the Analyze
 * gate. It is instantiated by the InsightView hook (not by `RunControls` itself)
 * so the state lives ABOVE the form and survives the CONFIGURE → RUNNING →
 * RESULTS phase swaps and pre-fills on "New run".
 *
 * @param disabled when true (e.g. no active project), Analyze is never permitted.
 */
export function useRunConfig(disabled: boolean): RunConfigState {
  const [scope, setScope] = useState<AnalysisScope>('repo');
  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<FindingCategory>>(
    () => new Set(ALL_CATEGORIES),
  );

  const orderedSelected = useMemo(
    () => ALL_CATEGORIES.filter((c) => selected.has(c)),
    [selected],
  );
  const canAnalyze = !disabled && orderedSelected.length > 0;

  return {
    scope,
    setScope,
    model,
    setModel,
    effort,
    setEffort,
    selected,
    toggle: (category) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(category)) next.delete(category);
        else next.add(category);
        return next;
      }),
    selectAll: () => setSelected(new Set(ALL_CATEGORIES)),
    selectNone: () => setSelected(new Set()),
    prefill: ({ scope: nextScope, model: nextModel, categories }) => {
      if (nextScope != null) setScope(nextScope);
      if (nextModel !== undefined) setModel(nextModel);
      if (categories !== undefined && categories.length > 0) {
        setSelected(new Set(categories));
      }
    },
    orderedSelected,
    canAnalyze,
  };
}
