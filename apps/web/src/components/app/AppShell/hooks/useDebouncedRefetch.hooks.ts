import { useCallback, useEffect, useRef } from 'react';

/** Trailing-edge debounce window for `nc:task`-driven refetches (ms). A burst of
 *  task events (each of which would otherwise refetch — and a worktree refetch
 *  spawns git subprocesses) collapses to a single trailing call. */
const REFETCH_DEBOUNCE_MS = 250;

/** Wrap a refetch in a trailing debounce: rapid calls coalesce, and the latest
 *  call still fires once the burst settles. The pending timer is cleared on
 *  unmount so a late timeout can't refetch after teardown. The returned trigger
 *  is stable; callers keep their own monotonic request-id staleness guards inside
 *  `refetch` (this only governs WHEN a refetch is dispatched, not which response
 *  is applied). */
export function useDebouncedRefetch(
  refetch: () => void,
  delayMs: number = REFETCH_DEBOUNCE_MS,
): () => void {
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  return useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      refetchRef.current();
    }, delayMs);
  }, [delayMs]);
}
