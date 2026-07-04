/**
 * The shared scan run-lifecycle hook, hoisted out of the four structurally-identical
 * scan siblings (Insight / Harness / Scorecard / PR-Review). Each `*View.hooks.ts`
 * had re-implemented the exact same machinery — run-history load, live-stream
 * subscribe, reconcile-on-complete, optimistic-start with a synchronous
 * re-entrancy guard, and cancel/select — differing only in the family's event
 * union, run/stream types, and bridge command names. This hook owns all of that
 * boilerplate; each family injects its projection (`streamFromRun`), its bridge
 * seams (`listRuns` / `getRun` / `cancelRun` / `subscribe`), and its event body
 * (`onEvent`, which folds live events and applies the family's single-item side
 * effects). Mirrors the backend's `scan_lifecycle_commands!` macro over generic
 * `ScanStore` / `ScanRun` (see `packages/engine/src/scans/shared/`).
 *
 * `apps/web/src/lib/` is the only place the `no-cross-feature-imports` lint permits
 * cross-family sharing, so this lives here rather than in any feature folder.
 */
import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

/** Every scan run is keyed by a stable `id`. */
interface ScanRunLike {
  id: string;
}

/** Every folded scan stream carries the id of the run it projects (`null` idle). */
interface ScanStreamLike {
  runId: string | null;
}

/**
 * The tools the generic hook hands the family's live-event body. The family
 * classifies the event, applies any single-item side effect through `setStream`,
 * gates fold events on `activeRunId`, and calls `reconcile` on the terminal event.
 */
export interface ScanEventContext<Run, Stream> {
  /** The run the live stream is being folded into (a ref: read `.current`). */
  activeRunId: MutableRefObject<string | null>;
  setStream: Dispatch<SetStateAction<Stream>>;
  /** Re-list persisted runs (updates `runs`); returns the fresh list. */
  refreshRuns: () => Promise<Run[]>;
  /** Authoritatively re-project the persisted run on a terminal event. */
  reconcile: (runId: string) => Promise<void>;
}

/** The per-family configuration injected into {@link useScanRun}. */
export interface ScanRunConfig<Event, Run extends ScanRunLike, Stream extends ScanStreamLike> {
  /** The idle stream — the initial state and the reset target. */
  emptyStream: Stream;
  /** List persisted runs, newest-first (the bridge `list*Runs` command). */
  listRuns: () => Promise<Run[]>;
  /** Fetch one persisted run by id (the bridge `get*Run` command). */
  getRun: (runId: string) => Promise<Run | null>;
  /** Project a persisted run into the live stream shape. */
  streamFromRun: (run: Run) => Stream;
  /** Request cancellation of a run (the bridge `cancel*` command). */
  cancelRun: (runId: string) => Promise<void>;
  /** Subscribe to the live event stream; resolves an unlisten fn. */
  subscribe: (handler: (event: Event) => void) => Promise<() => void>;
  /** Handle one live event (fold + family side effects). */
  onEvent: (event: Event, ctx: ScanEventContext<Run, Stream>) => void;
  /**
   * Optional custom persisted projection on reconcile — the default is
   * `streamFromRun(run)`. Harness overrides it to preserve the live fold's
   * `failureReason` (the persisted run drops it, so reconciling a user cancel
   * would otherwise revert the neutral notice to a red failure banner).
   */
  reconcileStream?: (run: Run, prev: Stream) => Stream;
}

/** Everything the generic hook exposes to a family's data hook. */
export interface ScanRunApi<Run extends ScanRunLike, Stream extends ScanStreamLike> {
  stream: Stream;
  setStream: Dispatch<SetStateAction<Stream>>;
  runs: Run[];
  isStarting: boolean;
  startError: string | null;
  /** The run the live stream is folded into (set by `runStart` / `selectRun`). */
  activeRunId: MutableRefObject<string | null>;
  refreshRuns: () => Promise<Run[]>;
  reconcile: (runId: string) => Promise<void>;
  cancel: () => Promise<void>;
  selectRun: (runId: string) => Promise<void>;
  /**
   * Launch a run behind the shared optimistic-start machinery: the synchronous
   * re-entrancy guard (two fast clicks can't mint two run-ids / two paid runs),
   * the `isStarting` / `startError` flags, `activeRunId` arming, the optimistic
   * stream swap, and the follow-up `refreshRuns`.
   *
   * @param precheck the family's launch gate (e.g. has-project + non-empty lens
   *   set); a `false` here is a silent no-op that resolves `false`.
   * @param launch fires the bridge start command and returns the new run-id plus
   *   the optimistic running stream to show until the `*-started` event lands.
   * @returns `true` once the run is armed; `false` on guard-out or start error.
   */
  runStart: (
    precheck: boolean,
    launch: () => Promise<{ runId: string; optimistic: Stream }>,
  ) => Promise<boolean>;
}

/**
 * Own the shared scan run-lifecycle state, effects, and controls. See the module
 * comment for the division of labor with the injected {@link ScanRunConfig}.
 */
export function useScanRun<
  Event,
  Run extends ScanRunLike,
  Stream extends ScanStreamLike,
>(config: ScanRunConfig<Event, Run, Stream>): ScanRunApi<Run, Stream> {
  const [stream, setStream] = useState<Stream>(config.emptyStream);
  const [runs, setRuns] = useState<Run[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // The run the live event stream is folded into. A ref so the once-installed
  // listener always reads the latest without re-subscribing.
  const activeRunId = useRef<string | null>(null);
  // Synchronous re-entrancy guard for `runStart`: blocks a second dispatch in the
  // render-timing gap before the disabled run button / optimistic running state
  // lands, so two fast clicks can't mint two run-ids and launch two paid runs.
  const inFlight = useRef(false);

  // The config is read through a ref so the subscribe/reconcile callbacks stay
  // identity-stable across renders (the live listener installs exactly once),
  // even though the family passes a fresh `onEvent` / `reconcileStream` closure
  // every render.
  const cfgRef = useRef(config);
  cfgRef.current = config;

  const refreshRuns = useCallback(async () => {
    const next = await cfgRef.current.listRuns();
    setRuns(next);
    return next;
  }, []);

  const reconcile = useCallback(
    async (runId: string) => {
      const run = await cfgRef.current.getRun(runId);
      if (run !== null) {
        const { reconcileStream, streamFromRun } = cfgRef.current;
        setStream((prev) =>
          reconcileStream ? reconcileStream(run, prev) : streamFromRun(run),
        );
      }
      await refreshRuns();
    },
    [refreshRuns],
  );

  // Initial load: list runs and display the newest (already sorted newest-first).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await refreshRuns();
      if (cancelled || next.length === 0) return;
      const newest = next[0];
      if (newest === undefined) return;
      activeRunId.current = newest.id;
      setStream(cfgRef.current.streamFromRun(newest));
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshRuns]);

  // Subscribe to the live stream once. The event body is read from the config ref
  // so a fresh `onEvent` closure never forces a re-subscribe.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void (async () => {
      const fn = await cfgRef.current.subscribe((event) => {
        cfgRef.current.onEvent(event, {
          activeRunId,
          setStream,
          refreshRuns,
          reconcile,
        });
      });
      if (disposed) fn();
      else unlisten = fn;
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [refreshRuns, reconcile]);

  const runStart = useCallback(
    async (
      precheck: boolean,
      launch: () => Promise<{ runId: string; optimistic: Stream }>,
    ): Promise<boolean> => {
      if (!precheck) return false;
      // Set synchronously, before the first await: a second click that slips
      // through the render gap before `isStarting`/the optimistic running state
      // disables the run button is a no-op instead of a second paid run.
      if (inFlight.current) return false;
      inFlight.current = true;
      setIsStarting(true);
      setStartError(null);
      try {
        const { runId, optimistic } = await launch();
        activeRunId.current = runId;
        setStream(optimistic);
        await refreshRuns();
        return true;
      } catch (err) {
        setStartError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setIsStarting(false);
        inFlight.current = false;
      }
    },
    [refreshRuns],
  );

  // `cancel` targets the displayed run (`stream.runId`, read through a ref so the
  // callback stays stable), which matches `activeRunId` in every armed state.
  const streamRef = useRef(stream);
  streamRef.current = stream;
  const cancel = useCallback(async () => {
    const runId = streamRef.current.runId;
    if (runId === null) return;
    await cfgRef.current.cancelRun(runId);
  }, []);

  const selectRun = useCallback(async (runId: string) => {
    const run = await cfgRef.current.getRun(runId);
    if (run === null) return;
    activeRunId.current = runId;
    setStream(cfgRef.current.streamFromRun(run));
  }, []);

  return {
    stream,
    setStream,
    runs,
    isStarting,
    startError,
    activeRunId,
    refreshRuns,
    reconcile,
    cancel,
    selectRun,
    runStart,
  };
}
