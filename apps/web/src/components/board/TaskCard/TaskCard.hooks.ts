import { useEffect, useState } from 'react';

/** Format a millisecond elapsed span as mm:ss. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

/** A live mm:ss elapsed timer counting up from `since`, ticking once a second
 *  while `active`. Used by the running card and the detail drawer header. */
export function useElapsed(since: number, active: boolean): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active, since]);
  return formatElapsed(now - since);
}
