import { useState } from 'react';

/** Generic collapse state for a session-log block. The latest session opens by
 *  default (`defaultOpen`); older sessions stay collapsed until clicked. The
 *  initializer runs once — toggling is never fought by re-renders. */
export function useCollapse(defaultOpen: boolean): { open: boolean; toggle: () => void } {
  const [open, setOpen] = useState(defaultOpen);
  return { open, toggle: () => setOpen((v) => !v) };
}
