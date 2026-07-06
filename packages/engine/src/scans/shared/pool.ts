/**
 * The bounded-concurrency pool shared by every scan orchestrator. Split out of the
 * {@link ScanManager} base class so a concurrency fix lands in one place,
 * independent of the orchestration mechanics.
 */

/**
 * Run `worker` over `items` with at most `concurrency` in flight. Resolves when all
 * are done. A worker that throws propagates (the orchestrator wraps the whole pool in
 * try/catch). Order of completion is not guaranteed; effects are emitted as each
 * finishes (streaming UX). Shared by every scan orchestrator so a concurrency fix
 * lands in one place.
 */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const cap = Math.max(1, Math.min(concurrency, items.length || 1));
  let cursor = 0;
  const runNext = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: cap }, () => runNext()));
}
