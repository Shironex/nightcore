/** Props for the {@link import('./ReplyDiff').ReplyDiff} side-by-side reply diff. */
import type { ReplyRound } from '../reply-diff';

export interface ReplyDiffProps {
  /** The broadcast rounds to render, oldest → newest (the last is the final positions).
   *  Derived from the live transcript via {@link import('../reply-diff').groupReplyRounds}. */
  rounds: ReplyRound[];
}
