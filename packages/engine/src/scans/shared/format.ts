/**
 * Small formatters for scan log lines — cost, per-pass duration, whole-scan
 * elapsed. Split out of the {@link ScanManager} base class so a log-format tweak
 * never touches the orchestrator; shared by every scan manager.
 */

/** `$1.20`-style cost for a log line. */
export function fmtCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/** `41.2s`-style short duration for a per-pass log line. */
export function fmtSecs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** `6:12`-style elapsed for a whole-scan log line. */
export function fmtElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
