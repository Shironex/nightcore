/**
 * Broadcast input to all visible panes — the grid-mode "type once, run everywhere"
 * fan-out (build spec — terminal round 2, PR B). A plain feature-root module (never
 * React state, like `terminal-command-capture`), so BOTH the session manager's single
 * input path and the keymap's manual emit paths consult ONE armed flag + ONE targeting
 * rule.
 *
 * A LOUD footgun by design: while armed, every keystroke in the FOCUSED pane fans out
 * to every VISIBLE pane. Two safety rails make an accidental broadcast impossible to
 * miss or to leave lingering:
 *  - the armed state auto-disarms the moment broadcast stops being eligible — leaving
 *    grid view, zooming a pane, or the visible set collapsing to one ({@link isBroadcastEligible},
 *    wired to the layout's view-mode / visible-set source);
 *  - every receiving pane + the toggle itself show an unmissable amber indicator (§ B.3).
 *
 * Broadcast NEVER reaches a read-only restored pane (a dead session has no PTY write
 * path and never carries keyboard focus) or a zoomed-single pane (zoom collapses the
 * visible set to one → auto-disarm). Targeting is VISIBLE-ONLY by construction: the
 * target list is exactly the session manager's `visibleIds` set (grid's mounted panes).
 *
 * The armed flag is mirrored here from the view's React state ({@link setBroadcastArmed},
 * the `setAiNamingEnabled` idiom); the fan-out reads it live on every keystroke.
 *
 * Lives in a feature-root module (not the session manager) so the input path can funnel
 * through {@link writeToTargets} without pushing the manager past the 400-line ratchet —
 * the sanctioned escape valve for the terminal feature.
 */
import { writeTerminal } from '@/lib/bridge';

/** Whether broadcast is currently armed. Module-level (not React) so the non-React
 *  input paths — the session manager's `onData` and the keymap's multiline / kill-line
 *  emits — read it without a subscription. */
let armed = false;

/** Mirror the view's `broadcastArmed` React state into the module so the fan-out reads
 *  it live. Turning it off here stops every subsequent keystroke from fanning out. */
export function setBroadcastArmed(on: boolean): void {
  armed = on;
}

/** Whether broadcast is armed right now. Read by {@link resolveBroadcastTargets}'s
 *  callers on every write. */
export function isBroadcastArmed(): boolean {
  return armed;
}

/** Whether broadcast is even ELIGIBLE to be armed: grid view with at least two visible
 *  panes. Tabs view, a single pane, and the zoomed-single state (zoom collapses the
 *  visible set to one) are all ineligible — the view auto-disarms whenever this turns
 *  false, so a LOUD footgun never lingers off-grid. Pure + unit-tested. */
export function isBroadcastEligible(isGrid: boolean, visibleCount: number): boolean {
  return isGrid && visibleCount > 1;
}

/** Resolve the session ids a write from `originId` lands on. Disarmed (or no visible
 *  panes) → the origin alone — exactly today's behavior. Armed → every VISIBLE pane
 *  (the grid's mounted panes), deduped, always including the origin so the user's own
 *  keystroke is never dropped ("keep the self-write"). Visible-only by construction:
 *  restored / off-screen / zoomed-away panes are absent from `visibleIds`. Pure +
 *  unit-tested — the fan-out targeting decision lives here, not in the writer. */
export function resolveBroadcastTargets(
  originId: string,
  armedNow: boolean,
  visibleIds: readonly string[],
): string[] {
  if (!armedNow || visibleIds.length === 0) return [originId];
  const targets = new Set<string>(visibleIds);
  targets.add(originId);
  return [...targets];
}

/** Write user-input bytes to `originId`'s shell, fanning them out to every VISIBLE pane
 *  when broadcast is armed — else to `originId` alone (today's behavior). The single
 *  fan-out point every emit path funnels through: the focused pane's `onData` (typing
 *  AND xterm `paste`, which rides `onData`) and the keymap's manual multiline /
 *  kill-line emits. `visibleIds` is the session manager's visible-set snapshot (grid's
 *  mounted panes) passed at call time. Returns the ids written (for tests + callers that
 *  ignore it). */
export function writeToTargets(
  originId: string,
  data: Uint8Array,
  visibleIds: readonly string[],
): string[] {
  const targets = resolveBroadcastTargets(originId, armed, visibleIds);
  for (const id of targets) void writeTerminal(id, data);
  return targets;
}
