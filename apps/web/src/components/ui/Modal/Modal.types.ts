import type { ReactNode } from 'react';

import type { Variants } from '../motion';

/** Props for {@link Modal}. */
export interface ModalProps {
  /** Presence flag — Modal OWNS its enter/exit animation, so callers keep it
   *  always-mounted and toggle `open` (rather than `{cond && <Modal/>}`). When it
   *  flips false the panel + backdrop animate out before unmounting. */
  open: boolean;
  /** Accessible name for the dialog. */
  label: string;
  /** `dialog` (default) or `alertdialog` (destructive confirmations). */
  role?: 'dialog' | 'alertdialog';
  /** Panel chrome preset. `dialog` (default) = a centered card with the canonical
   *  14px radius; `sheet` = a full-height edge sheet with a left border and no
   *  radius. The variant OWNS the shared chrome (`border`/`bg-popover`/`shadow`),
   *  so call sites pass only their own width/height via {@link panelClassName}. */
  variant?: 'dialog' | 'sheet';
  /** CSS selector for the element to focus on open. Defaults to the first
   *  focusable descendant. */
  initialFocus?: string;
  /** Classes for the centered overlay (positioning + backdrop). A sensible
   *  centered default is used when omitted. */
  overlayClassName?: string;
  /** Extra panel classes — width/height/layout ONLY (e.g. `w-[480px]`,
   *  `max-w-lg`, `flex max-h-[80vh] flex-col`). The chrome (border, background,
   *  shadow, radius) comes from {@link variant}; don't repeat it here. */
  panelClassName?: string;
  /** Motion variants for the panel's enter/exit. Defaults to `scaleFade` (centered
   *  dialogs); pass `slideIn` for an edge sheet. Must be transform + opacity only. */
  panelVariants?: Variants;
  /** Esc, click-outside, and the close affordance route here. */
  onClose: () => void;
  /** Optional confirm-on-Cmd/Ctrl+Enter. When set, Cmd/Ctrl+Enter anywhere in the
   *  dialog (outside a textarea) invokes it — the house dialog rule (bare Enter
   *  never confirms). See {@link isConfirmEnter}. */
  onEnter?: () => void;
  children: ReactNode;
}
