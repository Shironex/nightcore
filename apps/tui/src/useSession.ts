import { useCallback, useEffect, useReducer } from 'react';
import type { SessionManager } from '@nightcore/engine';
import type {
  PermissionDecision,
  PermissionMode,
} from '@nightcore/contracts';
import { initialView, reduce } from './session-reducer.js';
import type { SessionView } from './types.js';

export interface SessionApi {
  view: SessionView;
  /** Start a new session (or send follow-up input into the live one). */
  submit: (text: string) => void;
  /** Interrupt the live session. */
  interrupt: () => void;
  /** Flip plan ↔ build; returns the mode it switched to. */
  togglePermissionMode: () => void;
  /** Respond to the pending permission request. */
  resolvePermission: (decision: PermissionDecision) => void;
  /** True while a session is live (not idle and not in a terminal state). */
  isBusy: boolean;
}

/** plan = read-only; build = auto-accept edits. The two daily-driver modes. */
const PLAN: PermissionMode = 'plan';
const BUILD: PermissionMode = 'acceptEdits';

/**
 * The single engine-subscription hook. Owns a reducer over the `NightcoreEvent`
 * stream and exposes typed command dispatchers. The TUI is otherwise a pure view
 * over `view` — every mutation routes back through a `SurfaceCommand`.
 */
export function useSession(
  manager: SessionManager,
  defaults: { model: string; permissionMode: PermissionMode },
): SessionApi {
  const [view, dispatch] = useReducer(
    reduce,
    defaults,
    (d) => initialView(d.model, d.permissionMode),
  );

  useEffect(() => manager.on(dispatch), [manager]);

  const submit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0) return;
      if (view.sessionId === null || isTerminal(view.status)) {
        void manager.dispatch({
          type: 'start-session',
          prompt: trimmed,
          model: view.model,
          permissionMode: view.permissionMode,
        });
      } else {
        void manager.dispatch({
          type: 'send-input',
          sessionId: view.sessionId,
          text: trimmed,
        });
      }
    },
    [manager, view.sessionId, view.status, view.model, view.permissionMode],
  );

  const interrupt = useCallback(() => {
    if (view.sessionId === null || isTerminal(view.status)) return;
    void manager.dispatch({ type: 'interrupt', sessionId: view.sessionId });
  }, [manager, view.sessionId, view.status]);

  const togglePermissionMode = useCallback(() => {
    const next = view.permissionMode === PLAN ? BUILD : PLAN;
    // No engine event mirrors a mode change, so echo it locally regardless (so a
    // not-yet-started session still shows the choice in the header).
    dispatch({ type: 'ui-set-mode', mode: next });
    if (view.sessionId !== null && !isTerminal(view.status)) {
      void manager.dispatch({
        type: 'set-permission-mode',
        sessionId: view.sessionId,
        mode: next,
      });
    }
  }, [manager, view.permissionMode, view.sessionId, view.status]);

  const resolvePermission = useCallback(
    (decision: PermissionDecision) => {
      const pending = view.pendingPermission;
      if (pending === null || view.sessionId === null) return;
      void manager.dispatch({
        type: 'approve-permission',
        sessionId: view.sessionId,
        requestId: pending.requestId,
        decision,
      });
      dispatch({ type: 'ui-permission-resolved' });
    },
    [manager, view.pendingPermission, view.sessionId],
  );

  return {
    view,
    submit,
    interrupt,
    togglePermissionMode,
    resolvePermission,
    isBusy: view.sessionId !== null && !isTerminal(view.status),
  };
}

function isTerminal(status: SessionView['status']): boolean {
  return (
    status === 'idle' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'interrupted'
  );
}
