/** Open/close state for the ToolbarOption settings popover. */
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

/** The popover control returned by {@link useToolbarOptionSettings}. */
export interface ToolbarOptionSettingsControl {
  /** Whether the settings panel is open. */
  open: boolean;
  /** Toggle the panel. */
  toggle: () => void;
  /** Close the panel. */
  close: () => void;
  /** Root ref for outside-click detection (wrap the trigger + panel). */
  rootRef: RefObject<HTMLDivElement | null>;
  /** The settings trigger ref — focus returns here on keyboard dismissal. */
  triggerRef: RefObject<HTMLButtonElement | null>;
}

/** Anchored-popover open state with outside-click + Esc close, Tab-out close, and
 *  keyboard focus management (focus the first option on open; return focus to the
 *  trigger on Esc), mirroring the `Menu` primitive's dismissal + first-item focus. */
export function useToolbarOptionSettings(): ToolbarOptionSettingsControl {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);
  const closeAndRestore = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>('[role="switch"]')?.focus();

    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeAndRestore();
      }
    };
    const root = rootRef.current;
    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (next !== null && root !== null && !root.contains(next)) close();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    root?.addEventListener('focusout', onFocusOut);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      root?.removeEventListener('focusout', onFocusOut);
    };
  }, [open, close, closeAndRestore]);

  return { open, toggle, close, rootRef, triggerRef };
}
