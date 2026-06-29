import type { KeyboardEvent } from 'react';

/** Enabled options inside a roving `tablist`/`radiogroup` container. */
const ROVING_SELECTOR = '[role="tab"]:not(:disabled), [role="radio"]:not(:disabled)';

/**
 * Keyboard roving for a composite `tablist`/`radiogroup` whose options are
 * `<button role="tab|radio">`s. Arrow keys (and Home/End) move focus across the
 * enabled options and ACTIVATE the target (via the button's own click), so a
 * keyboard user gets the arrow-key model the role advertises — previously these
 * widgets announced `role="tab"`/`role="radio"` but ignored arrows entirely.
 *
 * Attach to each focusable option button (NOT the container — a container with a
 * key handler but no focus trips `jsx-a11y/interactive-supports-focus`); the handler
 * walks up to the enclosing group via `closest`. Pair with
 * `tabIndex={isActive ? 0 : -1}` so the whole group is a single Tab stop (roving
 * tabindex). Wrap-around at both ends; a no-op for keys it doesn't handle.
 */
export function rovingKeydown(e: KeyboardEvent<HTMLButtonElement>): void {
  const step =
    e.key === 'ArrowRight' || e.key === 'ArrowDown'
      ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
        ? -1
        : 0;
  const jump = e.key === 'Home' ? 'first' : e.key === 'End' ? 'last' : null;
  if (step === 0 && jump === null) return;

  const group = e.currentTarget.closest('[role="tablist"], [role="radiogroup"]');
  if (group === null) return;
  const items = Array.from(group.querySelectorAll<HTMLButtonElement>(ROVING_SELECTOR));
  if (items.length === 0) return;
  e.preventDefault();

  const target =
    jump === 'first'
      ? items[0]
      : jump === 'last'
        ? items[items.length - 1]
        : items[(Math.max(0, items.indexOf(e.currentTarget)) + step + items.length) % items.length];

  // Focus AND activate: native `button.click()` fires the React onClick, so arrowing
  // selects (automatic activation for tabs; standard radio behavior).
  target?.focus();
  target?.click();
}
