/**
 * Scan sub-session observability — a throttled heartbeat that turns a long, locally-
 * consumed lens/synthesis pass into steady terminal life without flooding the log or
 * leaking model-controlled args. Split out of the {@link ScanManager} base class so
 * the observability concern lives on its own.
 */
import type { NightcoreEvent } from '@nightcore/contracts';
import type { Logger } from '@nightcore/shared';

/** Heartbeat throttle: at most one progress line per sub-session this often. A
 *  16-minute scan used to print two lines then go silent; this surfaces steady life
 *  without flooding the terminal. */
const HEARTBEAT_INTERVAL_MS = 3000;

/**
 * Build a throttled heartbeat sink for an internal sub-session. The lens/synthesis
 * sub-sessions are consumed locally (never forwarded to the wire), so a long pass
 * looks frozen from the terminal. This counts `tool-use-requested` events as "turns"
 * and logs at most once per {@link HEARTBEAT_INTERVAL_MS} via `logger.info` (info
 * shows by default; debug is filtered) e.g. `[insight:perf] turn 12 · Read
 * src/app.ts`. Call the returned sink for EVERY sub-session event — it ignores
 * everything but tool uses. A no-op when there is no logger.
 */
export function makeHeartbeat(
  logger: Logger | undefined,
  label: string,
): (event: NightcoreEvent) => void {
  if (logger === undefined) return () => {};
  let turn = 0;
  let lastBeatAt = 0;
  return (event) => {
    if (event.type !== 'tool-use-requested') return;
    turn += 1;
    const now = Date.now();
    if (now - lastBeatAt < HEARTBEAT_INTERVAL_MS) return;
    lastBeatAt = now;
    logger.info(
      `${label} turn ${turn} · ${summarizeToolUse(event.toolName, event.input)}`,
    );
  };
}

/** A short, secret-free descriptor of a tool use for the heartbeat line — the tool
 *  name plus, ONLY for path-like args, its target path (truncated). We never surface
 *  model-controlled value args (pattern/command/query/prompt) here: they can carry
 *  secrets/PII and would leak to the persistent terminal + rolling log. */
function summarizeToolUse(toolName: string, input: unknown): string {
  const rec =
    typeof input === 'object' && input !== null
      ? (input as Record<string, unknown>)
      : {};
  const pick = (key: string): string | undefined =>
    typeof rec[key] === 'string' ? (rec[key] as string) : undefined;
  const detail = pick('file_path') ?? pick('path') ?? pick('notebook_path');
  if (detail === undefined) return toolName;
  const trimmed = detail.replace(/\s+/g, ' ').trim();
  const short = trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
  return `${toolName} ${short}`;
}
