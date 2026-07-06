/**
 * The shared RESULTS-screen view-state cluster, hoisted out of the scan view
 * models (Insight / Harness / Scorecard) that had each re-declared the same
 * five states and controls: the active results tab, the detail-panel selection,
 * the `pending` + labeled-toast action runner, the explicit "New run"
 * `reconfiguring` override, and the RUNNING-screen lens peek.
 *
 * `apps/web/src/lib/` is the only place the `no-cross-feature-imports` lint
 * permits cross-family sharing, so this lives here alongside `useScanRun`.
 * The toast channel is injected (`notifyError`) so `lib/` stays below the
 * component layer.
 */
import { useCallback, useRef, useState } from 'react';

export interface ScanResultsViewOptions {
  /** Surface a failed item action (typically `(t, e) => toast.error(t, e)`). */
  notifyError: (title: string, err: unknown) => void;
}

/** Everything {@link useScanResultsView} exposes to a family's view model. */
export interface ScanResultsViewApi<Lens extends string> {
  /** The active results tab (`'all'` or one lens). */
  activeTab: 'all' | Lens;
  setActiveTab: (tab: 'all' | Lens) => void;
  /** The item open in the detail panel, or `null`. */
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  /** True while an item action (convert/dismiss/restore/…) is in flight. */
  pending: boolean;
  /** Run one item action behind `pending` with a labeled failure toast. */
  runAction: (label: string, fn: () => Promise<unknown>) => Promise<void>;
  /** The explicit "New run" override that returns RESULTS to CONFIGURE
   *  without discarding the persisted run. */
  reconfiguring: boolean;
  /** RUNNING partial-reveal: the finished lens currently peeked, if any. */
  peekLens: Lens | null;
  openPeek: (lens: Lens) => void;
  clearPeek: () => void;
  /** Drop the reconfigure/peek overrides — before launching a run, selecting a
   *  past run, or landing a preselect navigation. */
  resetTransient: () => void;
  /** Enter CONFIGURE from RESULTS ("New run"; the family pre-fills its form). */
  startReconfigure: () => void;
}

/** Own the shared results-view state cluster. See the module comment for the
 *  division of labor with the family view models. */
export function useScanResultsView<Lens extends string>(
  options: ScanResultsViewOptions,
): ScanResultsViewApi<Lens> {
  const [activeTab, setActiveTab] = useState<'all' | Lens>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [reconfiguring, setReconfiguring] = useState(false);
  const [peekLens, setPeekLens] = useState<Lens | null>(null);

  // Read through a ref so `runAction` stays identity-stable across renders.
  const optsRef = useRef(options);
  optsRef.current = options;

  const runAction = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      setPending(true);
      try {
        await fn();
      } catch (err) {
        // Callers fire this as `void runAction(...)`, so without this catch a
        // failed action would only clear `pending` and vanish — no toast, no
        // inline error (and the rejection escaping as an unhandled promise
        // rejection). Surface it through the family's toast channel.
        console.error(`${label} failed`, err);
        optsRef.current.notifyError(`Could not ${label}`, err);
      } finally {
        setPending(false);
      }
    },
    [],
  );

  const resetTransient = useCallback(() => {
    setReconfiguring(false);
    setPeekLens(null);
  }, []);

  const startReconfigure = useCallback(() => {
    setPeekLens(null);
    setReconfiguring(true);
  }, []);

  const openPeek = useCallback((lens: Lens) => setPeekLens(lens), []);
  const clearPeek = useCallback(() => setPeekLens(null), []);

  return {
    activeTab,
    setActiveTab,
    selectedId,
    setSelectedId,
    pending,
    runAction,
    reconfiguring,
    peekLens,
    openPeek,
    clearPeek,
    resetTransient,
    startReconfigure,
  };
}
