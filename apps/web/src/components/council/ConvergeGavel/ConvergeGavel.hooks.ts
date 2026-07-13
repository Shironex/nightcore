/**
 * Local form state for the {@link import('./ConvergeGavel').ConvergeGavel} (issue #353):
 * the seat selected for an `accept`, the ruling/reason note, and the in-flight/error
 * status of the verdict dispatch. Kept out of the component body (no-state-in-body); the
 * three verdicts (`accept` / `reject` / `judge`) map to one mediated resolve call.
 */
import { useCallback, useState } from 'react';

import type { CouncilConvergeDecision } from '@/lib/bridge';

import type {
  ConvergeResolve,
  ConvergeResolveOptions,
} from './ConvergeGavel.types';

export interface ConvergeGavelModel {
  /** The seat whose position an `accept` would adopt, or `null` when none is picked. */
  selectedSeatId: string | null;
  /** Pick the seat to adopt. */
  select: (seatId: string) => void;
  /** The ruling (for `judge`) or an optional reason (for `accept`/`reject`). */
  note: string;
  setNote: (value: string) => void;
  /** True while a verdict dispatch is in flight — disables the controls. */
  busy: boolean;
  /** The last dispatch failure, shown inline so the human can retry. */
  error: string | null;
  /** Whether an `accept` can be submitted (a seat is selected). */
  canAccept: boolean;
  /** Whether a `judge` ruling can be submitted (the note is non-empty). */
  canJudge: boolean;
  /** Adopt the selected seat's position. */
  accept: () => void;
  /** Reject every position — the run closes with no adopted outcome. */
  reject: () => void;
  /** Record the human's own ruling (the note). */
  judge: () => void;
  /** ⌘/Ctrl+↵ primary: accept the selected seat, else enter a ruling if one is typed. */
  submitPrimary: () => void;
}

export function useConvergeGavel(onResolve: ConvergeResolve): ConvergeGavelModel {
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dispatch = useCallback(
    async (decision: CouncilConvergeDecision, options?: ConvergeResolveOptions) => {
      setBusy(true);
      setError(null);
      try {
        await onResolve(decision, options);
        // On success the parent flips to `resolved` and unmounts the form, so `busy`
        // is intentionally left set to keep controls disabled through the transition.
      } catch (err) {
        setBusy(false); // re-enable on failure so the human can retry
        setError(
          err instanceof Error ? err.message : 'Could not record your verdict.',
        );
      }
    },
    [onResolve],
  );

  const trimmedNote = note.trim();
  const withNote = (): ConvergeResolveOptions | undefined =>
    trimmedNote.length > 0 ? { note: trimmedNote } : undefined;

  const accept = useCallback(() => {
    if (selectedSeatId === null || busy) return;
    void dispatch('accept', { seatId: selectedSeatId, ...withNote() });
  }, [busy, dispatch, selectedSeatId, trimmedNote]);

  const reject = useCallback(() => {
    if (busy) return;
    void dispatch('reject', withNote());
  }, [busy, dispatch, trimmedNote]);

  const judge = useCallback(() => {
    if (trimmedNote.length === 0 || busy) return;
    void dispatch('judge', { note: trimmedNote });
  }, [busy, dispatch, trimmedNote]);

  const submitPrimary = useCallback(() => {
    if (selectedSeatId !== null) accept();
    else if (trimmedNote.length > 0) judge();
  }, [accept, judge, selectedSeatId, trimmedNote]);

  return {
    selectedSeatId,
    select: setSelectedSeatId,
    note,
    setNote,
    busy,
    error,
    canAccept: selectedSeatId !== null,
    canJudge: trimmedNote.length > 0,
    accept,
    reject,
    judge,
    submitPrimary,
  };
}
