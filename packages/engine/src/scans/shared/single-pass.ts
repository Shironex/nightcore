/**
 * ONE scan pass with exactly one corrective retry on unparseable output — the unit
 * of work both the classic single-pass path and each deep round run. Extracted from
 * {@link ScanManager} (so the shared orchestrator stays under its file-size ratchet
 * and the deep round loop can drive the same pass logic) with its behavior preserved
 * verbatim: the retry re-asks with the feature's strict-JSON reminder, cancellation
 * short-circuits to an `aborted` outcome, and usage/cost accumulate across both tries.
 */
import type { TokenUsage } from '@nightcore/contracts';
import type { Logger } from '@nightcore/shared';

import type { ItemOutcome, SessionOutcome } from './scan-manager.js';
import { addUsage, EMPTY_USAGE } from './usage.js';

/** The per-pass seams the base assembles (closing over its command/preset/item/run)
 *  so the corrective-retry logic lives in one place, provider- and feature-agnostic. */
export interface PassContext<TFinding> {
  /** Run id, for the retry log line. */
  runId: string;
  /** Whether the run was cancelled (checked after each session). */
  isCancelled(): boolean;
  /** Spin one read-only session for `prompt` and capture its terminal outcome. */
  runSession(prompt: string): Promise<SessionOutcome>;
  /** Parse a session's raw result into 0-or-more items; `error` set ⇒ trigger retry. */
  parse(
    result: string,
    structuredOutput?: Record<string, unknown>,
  ): { findings: TFinding[]; error?: string };
  /** The strict-JSON reminder appended to the ONE corrective retry prompt. */
  reminderSuffix: string;
  logger?: Logger;
}

/**
 * Run one pass for `prompt` with a single corrective retry on unparseable output.
 * Byte-identical to the pre-extraction inline logic: on a parse error it re-asks once
 * with `reminderSuffix`; a cancel mid-pass returns `{ findings: [], reason: 'aborted' }`;
 * a session with no result surfaces its `error`/`reason`. `usage`/`costUsd` sum both
 * tries.
 */
export async function runCorrectivePass<TFinding>(
  ctx: PassContext<TFinding>,
  prompt: string,
): Promise<ItemOutcome<TFinding>> {
  const usage: TokenUsage = { ...EMPTY_USAGE };
  let costUsd = 0;

  const first = await ctx.runSession(prompt);
  addUsage(usage, first.usage);
  costUsd += first.costUsd;

  if (ctx.isCancelled()) {
    return { findings: [], usage, costUsd, error: 'cancelled', reason: 'aborted' };
  }
  if (first.result === undefined) {
    return {
      findings: [],
      usage,
      costUsd,
      error: first.error ?? 'no result',
      ...(first.reason !== undefined ? { reason: first.reason } : {}),
    };
  }

  let parsed = ctx.parse(first.result, first.structuredOutput);
  let reason = first.reason;
  if (parsed.error !== undefined) {
    ctx.logger?.debug('scan pass produced no JSON; retrying', { runId: ctx.runId });
    const retry = await ctx.runSession(`${prompt}${ctx.reminderSuffix}`);
    addUsage(usage, retry.usage);
    costUsd += retry.costUsd;
    if (ctx.isCancelled()) reason = 'aborted';
    else if (retry.result !== undefined) {
      parsed = ctx.parse(retry.result, retry.structuredOutput);
      reason = retry.reason;
    } else if (retry.reason !== undefined) {
      reason = retry.reason;
    }
  }

  return {
    findings: parsed.findings,
    usage,
    costUsd,
    ...(parsed.error !== undefined ? { error: parsed.error } : {}),
    ...(reason !== undefined ? { reason } : {}),
  };
}
