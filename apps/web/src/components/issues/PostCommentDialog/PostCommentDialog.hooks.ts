import { useEffect, useState } from 'react';

/** Own the "I've reviewed the comment" confirmation gate for the post dialog. The
 *  confirmation resets every time the dialog opens or closes, so posting always
 *  requires a fresh, explicit confirm of the current preview — a stale confirm can
 *  never carry over to a re-opened (possibly different) verdict. */
export function usePostConfirm(open: boolean): {
  confirmed: boolean;
  setConfirmed: (value: boolean) => void;
} {
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    setConfirmed(false);
  }, [open]);
  return { confirmed, setConfirmed };
}
