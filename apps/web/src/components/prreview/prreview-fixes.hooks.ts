/**
 * The stateful binding over the per-PR FIX registry (`nc:pr-fix`): ONE
 * subscription folds every full-state snapshot into a `Map<fixId, PrFixState>`,
 * reconciled from `list_pr_fixes` on mount. The registry itself is in-memory on
 * the Rust side — an app restart forgets entries (the fix COMMIT survives on the
 * branch), so there is no persisted store to reconcile beyond the live list.
 * The runs sibling is `prreview-runs.hooks.ts`; the PR-workspace view model
 * (`usePrReviewView`) drives both.
 */
import { useCallback, useRef, useState } from 'react';

import {
  addressReviewFindings,
  cancelPrFix,
  fixPrCi,
  listPrFixes,
  onPrFixEvent,
  type PrFixState,
  type PrFixStatus,
  pushPrFix,
  resolvePrConflicts,
} from '@/lib/bridge';
import { useLiveRegistry } from '@/lib/useLiveRegistry';

/** One fix-start outcome (`address` / `fixCi` / `resolveConflicts`): `fixId`
 *  set on success; `error` carries a rejection message (also recorded per-PR in
 *  `fixErrors`, but plumbed here so the caller can toast it synchronously);
 *  both `null` when guarded out. */
export interface AddressOutcome {
  fixId: string | null;
  error: string | null;
}

/** One-way lifecycle rank for the equal-`updatedAt` tie-break: two transitions
 *  can share a single millisecond (the Rust dispatch-failure path emits
 *  running→failed in the same ms), and on a timestamp tie the FURTHER-along
 *  status must win. `failed` is terminal — it ranks with `awaiting_push`. */
const FIX_STATUS_RANK: Record<PrFixStatus, number> = {
  running: 0,
  committing: 1,
  awaiting_push: 2,
  failed: 2,
  pushed: 3,
};

/** Rank a (free-string) status. An unknown future status ranks with
 *  `committing` — like it, an intermediate progress state past `running`. */
function fixStatusRank(status: string): number {
  return (FIX_STATUS_RANK as Record<string, number>)[status] ?? 1;
}

export interface UsePrFixesResult {
  /** Every known fix's latest snapshot, keyed by fix id. */
  fixes: ReadonlyMap<string, PrFixState>;
  /** Per-PR address failures, keyed by PR number. An entry clears on that PR's
   *  next successful address; concurrent PRs never clobber each other's error. */
  fixErrors: ReadonlyMap<number, string>;
  /** The PR's displayed fix: the latest by `updatedAt`, or `null` when the
   *  registry knows none for that PR (or the latest one was dismissed). */
  fixForPr: (prNumber: number) => PrFixState | null;
  /** Start a fix run over `findingIds` of review run `runId` on `prNumber`'s
   *  branch. Resolves the new fix id on success; a null `fixId` means guarded
   *  out (no project / empty selection / a fix already running or starting for
   *  this PR) or rejected — a rejection also carries its message as `error`
   *  (and lands in `fixErrors`). Different PRs may fix concurrently; the SAME
   *  PR cannot double-start. */
  address: (
    prNumber: number,
    runId: string,
    findingIds: string[],
  ) => Promise<AddressOutcome>;
  /** Start a fix run over the PR's FAILING CI checks — the same guard discipline
   *  and outcome shape as `address` (no review run required). */
  fixCi: (prNumber: number) => Promise<AddressOutcome>;
  /** Merge the PR's base into its checkout and resolve the conflicts (a clean
   *  merge skips the agent and parks at `awaiting_push` directly) — the same
   *  guard discipline and outcome shape as `address`. */
  resolveConflicts: (prNumber: number) => Promise<AddressOutcome>;
  /** Push an `awaiting_push` fix's branch — the human-gated publish.
   *  `postComment` also posts the summary comment on the PR (best-effort: a
   *  comment failure resolves as a warning string; `null` = no warning).
   *  Rejects on push failure so the caller's confirm gate can surface it. */
  push: (fixId: string, postComment: boolean) => Promise<string | null>;
  /** Cancel a running fix (it lands as `failed("cancelled")` on the channel).
   *  Rejects on failure so the caller can surface it. */
  cancel: (fixId: string) => Promise<void>;
  /** Hide a failed fix's card, LOCAL-ONLY: the registry entry survives (and a
   *  later fix for the same PR shows normally under its new id). */
  dismiss: (fixId: string) => void;
}

/**
 * Own the per-PR fix registry: subscribe ONCE to `nc:pr-fix`, fold every
 * full-state snapshot into the map (newer `updatedAt` wins, so a stale
 * `list_pr_fixes` read can never downgrade a live event that beat it), and
 * reconcile against the Rust in-memory registry on mount / project arrival.
 */
export function usePrFixes(hasProject: boolean): UsePrFixesResult {
  /** Locally-hidden failed fixes (the card's "dismiss"); never sent to Rust. */
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const live = useLiveRegistry<PrFixState, number>({
    hasProject,
    list: listPrFixes,
    subscribe: onPrFixEvent,
    getId: (f) => f.id,
    getUpdatedAt: (f) => f.updatedAt,
    getStatusRank: (f) => fixStatusRank(f.status),
  });
  const fixes = live.items;
  const fixErrors = live.errors;

  // The latest rendered map, for synchronous already-running checks in
  // start (state reads inside a callback can be a render behind).
  const fixesRef = useRef(fixes);
  fixesRef.current = fixes;

  const fixForPr = useCallback(
    (prNumber: number): PrFixState | null => {
      let best: PrFixState | null = null;
      for (const fix of fixes.values()) {
        if (fix.prNumber !== prNumber) continue;
        if (best === null || fix.updatedAt > best.updatedAt) best = fix;
      }
      if (best === null) return null;
      return dismissedIds.has(best.id) ? null : best;
    },
    [fixes, dismissedIds],
  );

  const startFix = useCallback(
    async (
      prNumber: number,
      invoke: () => Promise<string>,
    ): Promise<AddressOutcome> => {
      const { value: fixId, error } = await live.start(
        prNumber,
        invoke,
        () => {
          for (const fix of fixesRef.current.values()) {
            if (fix.prNumber === prNumber && fix.status === 'running') {
              return true;
            }
          }
          return false;
        },
      );
      return { fixId, error };
    },
    [live.start],
  );

  const address = useCallback(
    async (
      prNumber: number,
      runId: string,
      findingIds: string[],
    ): Promise<AddressOutcome> => {
      if (runId.length === 0 || findingIds.length === 0) {
        return { fixId: null, error: null };
      }
      return startFix(prNumber, () => addressReviewFindings(runId, findingIds));
    },
    [startFix],
  );

  const fixCi = useCallback(
    (prNumber: number) => startFix(prNumber, () => fixPrCi(prNumber)),
    [startFix],
  );

  const resolveConflicts = useCallback(
    (prNumber: number) => startFix(prNumber, () => resolvePrConflicts(prNumber)),
    [startFix],
  );

  const push = useCallback(async (fixId: string, postComment: boolean) => {
    return pushPrFix(fixId, postComment);
  }, []);

  const cancel = useCallback(async (fixId: string) => {
    await cancelPrFix(fixId);
  }, []);

  const dismiss = useCallback((fixId: string) => {
    setDismissedIds((prev) => new Set(prev).add(fixId));
  }, []);

  return {
    fixes,
    fixErrors,
    fixForPr,
    address,
    fixCi,
    resolveConflicts,
    push,
    cancel,
    dismiss,
  };
}
