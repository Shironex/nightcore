/**
 * The deep-scan ROUND LOOP (issue #294): the multi-round, exclusion-list convergence
 * engine a scan command opts into via its `deep` config. Extracted from
 * {@link ScanManager} so the shared orchestrator stays under its file-size ratchet
 * and the round mechanics are unit-testable in isolation.
 *
 * Only a `deep` command reaches here — the classic single-pass path never does, so it
 * stays byte-identical to pre-deep runs. Rounds are SEQUENTIAL within one item's pool
 * slot; the caller keeps items PARALLEL across slots (the pool is untouched). Net-new
 * is computed on the SAME fingerprint the final cross-category dedup uses, so a
 * round's contribution can never diverge from what `dedupeFindings` later collapses.
 */
import type { DeepScanConfig, TokenUsage } from '@nightcore/contracts';

import type { ItemOutcome, SessionFailedReason } from './scan-manager.js';
import { addUsage, EMPTY_USAGE } from './usage.js';

/** What one finished round reports to the feature's round-completed emitter. */
export interface RoundCompletedInfo<TFinding> {
  /** 1-based round index within this item's loop. */
  round: number;
  /** Net-new grounded findings this round added (post-dedup vs prior rounds). */
  newFindingsThisRound: number;
  /** The cumulative grounded findings for this item across all rounds so far. */
  cumulative: TFinding[];
  /** This round's OWN usage/cost/error (NOT cumulative), for per-round telemetry. */
  outcome: ItemOutcome<TFinding>;
  /** Wall-clock of this round, for the per-round log/event. */
  elapsedMs: number;
}

/** The feature-specific seams the generic round loop drives. The base
 *  {@link ScanManager} assembles these from its own hooks; a test supplies fakes. */
export interface RoundLoopHooks<TFinding> {
  deep: DeepScanConfig;
  /** Build round `round` (1-based)'s prompt; `foundSoFar` seeds the exclusion list. */
  buildPrompt(round: number, foundSoFar: readonly TFinding[]): string;
  /** Run one pass (one session + one corrective retry) for `prompt` → raw outcome. */
  runPass(prompt: string): Promise<ItemOutcome<TFinding>>;
  /** Ground one pass's raw findings against the tree (drop hallucinated refs). */
  ground(findings: TFinding[]): TFinding[];
  /** Stable dedup key for a grounded finding — net-new is counted on this. */
  fingerprint(finding: TFinding): string;
  /** Emit the feature's per-round event. */
  emitRoundCompleted(info: RoundCompletedInfo<TFinding>): void;
  /** Whether the run was cancelled (checked before + after each round). */
  isCancelled(): boolean;
}

/**
 * Run the deep round loop for one item. Stops when EITHER `convergenceEmptyRounds`
 * consecutive rounds add ZERO net-new (post-dedup) findings, OR `maxRoundsPerCategory`
 * is hit (the non-convergence backstop), OR the run is cancelled. Returns an
 * {@link ItemOutcome} whose `findings` is the grounded cross-round cumulative union
 * and whose usage/cost sum every round (so the caller accumulates the item's spend
 * exactly once). The last round's `error`/`reason`, if any, is surfaced.
 */
export async function runRoundLoop<TFinding>(
  hooks: RoundLoopHooks<TFinding>,
): Promise<ItemOutcome<TFinding>> {
  const { deep } = hooks;
  const foundSoFar: TFinding[] = [];
  const seen = new Set<string>();
  const usage: TokenUsage = { ...EMPTY_USAGE };
  let costUsd = 0;
  let emptyStreak = 0;
  let error: string | undefined;
  let reason: SessionFailedReason | undefined;

  for (let round = 1; round <= deep.maxRoundsPerCategory; round++) {
    if (hooks.isCancelled()) break;
    const roundStartedAt = Date.now();
    const outcome = await hooks.runPass(hooks.buildPrompt(round, foundSoFar));
    addUsage(usage, outcome.usage);
    costUsd += outcome.costUsd;
    if (outcome.error !== undefined) error = outcome.error;
    if (outcome.reason !== undefined) reason = outcome.reason;
    if (hooks.isCancelled()) break;

    let newFindingsThisRound = 0;
    for (const finding of hooks.ground(outcome.findings)) {
      const fp = hooks.fingerprint(finding);
      if (seen.has(fp)) continue;
      seen.add(fp);
      foundSoFar.push(finding);
      newFindingsThisRound++;
    }

    hooks.emitRoundCompleted({
      round,
      newFindingsThisRound,
      cumulative: [...foundSoFar],
      outcome,
      elapsedMs: Date.now() - roundStartedAt,
    });

    if (newFindingsThisRound === 0) {
      if (++emptyStreak >= deep.convergenceEmptyRounds) break;
    } else {
      emptyStreak = 0;
    }
  }

  return {
    findings: foundSoFar,
    usage,
    costUsd,
    ...(error !== undefined ? { error } : {}),
    ...(reason !== undefined ? { reason } : {}),
  };
}
