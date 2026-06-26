import { useState } from 'react';
import type { ConventionCategory } from '@/lib/bridge';
import { ALL_CATEGORIES } from '../harness.constants';
import type { RunControlsProps } from './RunControls.types';

export interface RunControlsView {
  /** Whether a scan is currently in flight (controls are read-only). */
  running: boolean;
  model: string | null;
  setModel: (model: string | null) => void;
  effort: string | null;
  setEffort: (effort: string | null) => void;
  /** The currently-selected lens set (membership test for chips). */
  selected: Set<ConventionCategory>;
  /** Toggle one lens in/out of the selected set. */
  toggle: (category: ConventionCategory) => void;
  /** Select every lens. */
  selectAll: () => void;
  /** Clear the selection. */
  selectNone: () => void;
  /** The selected lenses in canonical display order (sent on Scan). */
  orderedSelected: ConventionCategory[];
  /** Whether the Scan action is currently permitted. */
  canScan: boolean;
}

/** Owns the run-configuration form state: model/effort overrides and the selected
 *  lens set, plus the derived ordered selection and the Scan gate. There is no
 *  scope picker — Harness always scans the whole repo. The component shell renders
 *  purely from this view. */
export function useRunControls({
  stream,
  isStarting,
  disabled,
}: RunControlsProps): RunControlsView {
  const running = stream.status === 'running';
  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<ConventionCategory>>(
    () => new Set(ALL_CATEGORIES),
  );

  const toggle = (category: ConventionCategory) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const orderedSelected = ALL_CATEGORIES.filter((c) => selected.has(c));
  const canScan = !disabled && !running && !isStarting && orderedSelected.length > 0;

  return {
    running,
    model,
    setModel,
    effort,
    setEffort,
    selected,
    toggle,
    selectAll: () => setSelected(new Set(ALL_CATEGORIES)),
    selectNone: () => setSelected(new Set()),
    orderedSelected,
    canScan,
  };
}
