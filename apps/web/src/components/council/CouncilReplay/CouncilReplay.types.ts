/** Props for the {@link import('./CouncilReplay').CouncilReplay} read-only replay
 *  surface (issue #354, safety #7). */
import type { DebateTranscriptEntry } from '@/lib/bridge';

export interface CouncilReplayProps {
  /** The finished run's append-only transcript to reconstruct. Read-only: the replay
   *  re-renders these recorded entries and never re-dispatches a seat or resends a
   *  command. */
  transcript: DebateTranscriptEntry[];
  /** Leave replay and return to the finished run's board. */
  onExit: () => void;
}
