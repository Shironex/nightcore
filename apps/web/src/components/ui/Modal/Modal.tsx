/** Shared focus-trapped modal dialog primitive. */
import { createPortal } from 'react-dom';

import { AnimatePresence, backdrop, m, scaleFade } from '../motion';
import { isConfirmEnter, useModal } from './Modal.hooks';
import type { ModalProps } from './Modal.types';

const DEFAULT_OVERLAY =
  'fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm';

/** Shared panel chrome, keyed by `variant`. Each preset owns everything visual —
 *  border, background, shadow, and (for `dialog`) the canonical 14px radius — so
 *  call sites pass only their own width/height via `panelClassName`. `sheet` is a
 *  full-height edge sheet: a left border, no radius, and a column layout. */
const PANEL_CHROME: Record<NonNullable<ModalProps['variant']>, string> = {
  dialog: 'overflow-hidden rounded-[14px] border border-border bg-popover shadow-2xl',
  sheet:
    'flex h-full w-full flex-col overflow-hidden border-l border-border bg-popover shadow-2xl',
};

/** Default sizing for callers that pass no `panelClassName` (small centered card).
 *  The chrome comes from the `dialog` variant; this is width only. */
const DEFAULT_PANEL = 'w-full max-w-sm';

/** The shared modal primitive (a11y): an inert-background overlay over a focus-
 *  trapped dialog panel, with a Tab/Shift+Tab focus trap and focus restore to the
 *  opener on close.
 *
 *  Presence is owned here (`open`): an `AnimatePresence` fades the backdrop and
 *  scale/slides the panel on BOTH mount and unmount, so dialogs no longer hard-cut
 *  when closed. `MotionConfig reducedMotion="user"` (app root) collapses the
 *  transforms under OS reduced-motion, keeping only the opacity fade.
 *
 *  Esc and click-outside close; Cmd/Ctrl+Enter (when `onEnter` is set) confirms —
 *  bare Enter never does (the house dialog rule), and Enter inside a textarea
 *  always inserts a newline. Click-outside is suppressed when the click originates
 *  inside the panel.
 *
 *  The overlay is portaled to `document.body` so ancestor flex/transform/stacking
 *  rules (e.g. `.nc-board-appearance`) never participate in its layout.
 *
 *  `variant` owns the panel chrome: `dialog` (default) is a centered card with the
 *  canonical 14px radius; `sheet` is a full-height edge sheet (left border, no
 *  radius). Call sites contribute only their width/height via `panelClassName`. */
export function Modal({
  open,
  label,
  role = 'dialog',
  variant = 'dialog',
  initialFocus,
  overlayClassName = DEFAULT_OVERLAY,
  panelClassName = DEFAULT_PANEL,
  panelVariants = scaleFade,
  onClose,
  onEnter,
  children,
}: ModalProps) {
  const ref = useModal<HTMLDivElement>(onClose, initialFocus, open);
  // Chrome is owned by the variant; the call site contributes only width/layout.
  const panelClasses = `${PANEL_CHROME[variant]} ${panelClassName}`;

  const overlay = (
    <AnimatePresence>
      {open && (
        <m.div
          role="presentation"
          className={overlayClassName}
          onClick={onClose}
          variants={backdrop}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <m.div
            ref={ref}
            role={role}
            aria-modal="true"
            aria-label={label}
            className={panelClasses}
            variants={panelVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (onEnter !== undefined && isConfirmEnter(e)) {
                e.preventDefault();
                onEnter();
              }
            }}
          >
            {children}
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );

  if (typeof document === 'undefined') {
    return overlay;
  }

  return createPortal(overlay, document.body);
}
