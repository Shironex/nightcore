/**
 * Preflight-refusal mapping — extracted from {@link
 * import('./session-manager.js').SessionManager} for the engine file-size ratchet, mirroring
 * `session-start-params.ts`. Behavior verbatim.
 *
 * A provider REFUSES a start at the seam (issue #296) rather than silently dropping it: an
 * autonomy it can't confine (`AutonomyNotPermittedError`) or an ARMED Harness policy it can't
 * govern (`GovernanceNotSupportedError`). This maps that refusal to the terminal
 * `session-failed` the board renders like any other failure. No runner started, so — unlike a
 * crash — no concurrency slot was taken.
 */
import type { NightcoreEvent } from '@nightcore/contracts';
import type { Logger } from '@nightcore/shared';

import {
  AutonomyNotPermittedError,
  GovernanceNotSupportedError,
} from '../providers/agent-provider.js';

/**
 * Build the terminal `session-failed` event for a preflight refusal, or return `null` when
 * `error` is NOT a preflight refusal (the caller rethrows). Logs the refusal.
 *
 * `council` echoes the SEAT marker onto the terminal (issue #374): a refused COUNCIL seat
 * emits ONLY this `session-failed` — no `session-started` ever carried the marker — so the
 * Rust reader needs it here to SKIP board-FIFO correlation, else the refused seat could pop a
 * concurrently-pending board task's slot and mis-bind. A refused BOARD session carries no
 * marker, so its `session-failed` still correlates (to fail its own task).
 */
export function refusalEvent(
  id: number,
  error: unknown,
  council: boolean,
  logger: Logger | undefined,
): Extract<NightcoreEvent, { type: 'session-failed' }> | null {
  const councilMark = council ? { council: true as const } : {};
  if (error instanceof AutonomyNotPermittedError) {
    logger?.warn('session refused: autonomy not permitted', {
      id,
      providerId: error.providerId,
      autonomy: error.autonomy,
    });
    return {
      type: 'session-failed',
      sessionId: id,
      reason: 'runner-crash',
      message: error.message,
      ...councilMark,
    };
  }
  if (error instanceof GovernanceNotSupportedError) {
    logger?.warn('session refused: governance not supported', {
      id,
      providerId: error.providerId,
    });
    return {
      type: 'session-failed',
      sessionId: id,
      reason: 'runner-crash',
      message: error.message,
      ...councilMark,
    };
  }
  return null;
}
