import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

export interface PerPrStartResult<Pr extends number = number> {
  errors: ReadonlyMap<Pr, string>;
  inFlight: MutableRefObject<Set<Pr>>;
  start: <R>(
    prNumber: Pr,
    invoke: () => Promise<R>,
    isRunningCheck?: () => boolean,
  ) => Promise<{ value: R | null; error: string | null }>;
  clearError: (prNumber: Pr) => void;
  setError: (prNumber: Pr, message: string) => void;
}

export function usePerPrStart<Pr extends number = number>(
  hasProject: boolean,
): PerPrStartResult<Pr> {
  const [errors, setErrors] = useState<ReadonlyMap<Pr, string>>(
    () => new Map(),
  );
  const inFlight = useRef<Set<Pr>>(new Set());

  const clearError = useCallback(
    (prNumber: Pr) => {
      setErrors((prev) => {
        if (!prev.has(prNumber)) return prev;
        const next = new Map(prev);
        next.delete(prNumber);
        return next;
      });
    },
    [],
  );

  const setError = useCallback(
    (prNumber: Pr, message: string) => {
      setErrors((prev) => new Map(prev).set(prNumber, message));
    },
    [],
  );

  const start = useCallback(
    async <R>(
      prNumber: Pr,
      invoke: () => Promise<R>,
      isRunningCheck: () => boolean = () => false,
    ): Promise<{ value: R | null; error: string | null }> => {
      if (!hasProject) {
        return { value: null, error: null };
      }
      if (inFlight.current.has(prNumber)) {
        return { value: null, error: null };
      }
      if (isRunningCheck()) {
        return { value: null, error: null };
      }
      inFlight.current.add(prNumber);
      try {
        const value = await invoke();
        clearError(prNumber);
        return { value, error: null };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(prNumber, message);
        return { value: null, error: message };
      } finally {
        inFlight.current.delete(prNumber);
      }
    },
    [hasProject, clearError, setError],
  );

  return {
    errors,
    inFlight,
    start,
    clearError,
    setError,
  };
}

export interface LiveRegistryOptions<Entity> {
  hasProject: boolean;
  list: () => Promise<Entity[]>;
  subscribe: (handler: (entity: Entity) => void) => Promise<() => void>;
  getId: (entity: Entity) => string;
  getUpdatedAt: (entity: Entity) => number;
  getStatusRank?: (entity: Entity) => number;
}

export interface LiveRegistryResult<Entity, Pr extends number = number> {
  items: ReadonlyMap<string, Entity>;
  errors: ReadonlyMap<Pr, string>;
  start: PerPrStartResult<Pr>['start'];
}

export function useLiveRegistry<Entity, Pr extends number = number>(
  options: LiveRegistryOptions<Entity>,
): LiveRegistryResult<Entity, Pr> {
  const {
    hasProject,
    list,
    subscribe,
    getId,
    getUpdatedAt,
    getStatusRank,
  } = options;

  const getIdRef = useRef(getId);
  getIdRef.current = getId;
  const getUpdatedAtRef = useRef(getUpdatedAt);
  getUpdatedAtRef.current = getUpdatedAt;
  const getStatusRankRef = useRef(getStatusRank);
  getStatusRankRef.current = getStatusRank;

  const [items, setItems] = useState<ReadonlyMap<string, Entity>>(
    () => new Map(),
  );

  const upsert = useCallback((incoming: Entity) => {
    setItems((prev) => {
      const id = getIdRef.current(incoming);
      const existing = prev.get(id);
      if (existing !== undefined) {
        const exAt = getUpdatedAtRef.current(existing);
        const inAt = getUpdatedAtRef.current(incoming);
        if (exAt > inAt) return prev;
        const rankFn = getStatusRankRef.current ?? (() => 0);
        if (exAt === inAt && rankFn(existing) >= rankFn(incoming)) {
          return prev;
        }
      }
      const next = new Map(prev);
      next.set(id, incoming);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const listItems = await list();
      if (cancelled || !Array.isArray(listItems)) return;
      for (const entity of listItems) upsert(entity);
    })();
    return () => {
      cancelled = true;
    };
  }, [hasProject, list, upsert]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void (async () => {
      const fn = await subscribe(upsert);
      if (disposed) fn();
      else unlisten = fn;
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [subscribe, upsert]);

  const guard = usePerPrStart<Pr>(hasProject);

  return {
    items,
    errors: guard.errors,
    start: guard.start,
  };
}
