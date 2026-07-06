/**
 * Generic order-stable dedupe shared by every scan pipeline's cross-pass merge
 * (Insight / Harness / PR-review). Neutral home (no scans imports) — the callers
 * inject the key, the rank, and the merge, which is all that genuinely differs.
 */

export interface DedupeByOptions<T> {
  /** Rank for winner selection: the HIGHER-ranked instance wins; on a tie the
   *  FIRST-seen instance is kept (pass order is deterministic). */
  rank: (item: T) => number;
  /** Merge a duplicate pair into the stored survivor. Receives the winner plus
   *  both instances in encounter order (`existing` was stored first, `incoming`
   *  just arrived) so unions can stay encounter-ordered. Defaults to keeping the
   *  winner as-is. */
  merge?: (winner: T, existing: T, incoming: T) => T;
}

/**
 * Group `items` by `keyOf`, keep ONE survivor per key — the higher-{@link
 * DedupeByOptions.rank} instance, merged via {@link DedupeByOptions.merge} —
 * order-stable on each key's first appearance.
 */
export function dedupeBy<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  opts: DedupeByOptions<T>,
): T[] {
  const byKey = new Map<string, T>();
  const order: string[] = [];
  for (const item of items) {
    const key = keyOf(item);
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, item);
      order.push(key);
      continue;
    }
    const winner = opts.rank(item) > opts.rank(existing) ? item : existing;
    byKey.set(
      key,
      opts.merge !== undefined ? opts.merge(winner, existing, item) : winner,
    );
  }
  return order.map((key) => byKey.get(key) as T);
}
