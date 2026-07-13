/** Props + shared shapes for the {@link import('./ConvergeGavel').ConvergeGavel} — the
 *  human Converge gavel (issue #353). */
import type { CouncilConvergeDecision } from '@/lib/bridge';

import type { ConvergePosition } from '../council.types';

/** The optional data a verdict carries: the adopted `seatId` for an `accept`, and the
 *  ruling/reason `note`. */
export interface ConvergeResolveOptions {
  seatId?: string;
  note?: string;
}

/** Dispatch the human's terminal verdict, resolving the parked run through the Conductor
 *  (safety #7). A rejection is surfaced as an inline error so the human can retry. */
export type ConvergeResolve = (
  decision: CouncilConvergeDecision,
  options?: ConvergeResolveOptions,
) => Promise<void>;

export interface ConvergeGavelProps {
  /** The seats' final positions the human weighs — an `accept` adopts exactly one. */
  positions: ConvergePosition[];
  /** Dispatch the human's verdict. Rejections surface inline (and the parent may toast). */
  onResolve: ConvergeResolve;
  /** True once the run is closed — the recorded verdict is shown read-only, no actions. */
  resolved?: boolean;
  /** The recorded verdict text, shown when `resolved`. */
  verdict?: string | null;
}
