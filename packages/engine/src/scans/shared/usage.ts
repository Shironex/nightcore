/**
 * Token-usage accumulation for the scan family — the one piece of shared scan
 * mechanics small enough to stand alone. Lives here (rather than on the base
 * {@link ScanManager}) so both the base and the deep-mode round loop can import it
 * without a module cycle. Re-exported from `scan-manager.ts` so its public surface
 * (and every existing `../shared/scan-manager.js` importer) is unchanged.
 */
import type { TokenUsage } from '@nightcore/contracts';

/** A zeroed usage total; copy it (`{ ...EMPTY_USAGE }`) before accumulating. */
export const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  reasoningOutputTokens: 0,
};

/** Accumulate token usage in place. */
export function addUsage(into: TokenUsage, add: TokenUsage | undefined): void {
  if (add === undefined) return;
  into.inputTokens += add.inputTokens;
  into.outputTokens += add.outputTokens;
  into.cacheReadTokens += add.cacheReadTokens;
  into.cacheCreationTokens += add.cacheCreationTokens;
}
