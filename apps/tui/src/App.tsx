import { useCallback } from 'react';
import type { ReactNode } from 'react';
import type { KeyEvent } from '@opentui/core';
import { useKeyboard, useRenderer } from '@opentui/react';
import type { SessionManager } from '@nightcore/engine';
import type { PermissionMode } from '@nightcore/contracts';
import { useSession } from './useSession.js';
import { SessionHeader } from './components/SessionHeader.js';
import { StreamView } from './components/StreamView.js';
import { InputBox } from './components/InputBox.js';
import { PermissionPrompt } from './components/PermissionPrompt.js';
import { FooterHints } from './components/FooterHints.js';

interface AppProps {
  manager: SessionManager;
  defaults: { model: string; permissionMode: PermissionMode };
}

export function App({ manager, defaults }: AppProps): ReactNode {
  const renderer = useRenderer();
  const {
    view,
    submit,
    interrupt,
    togglePermissionMode,
    resolvePermission,
    isBusy,
  } = useSession(manager, defaults);

  const hasPermission = view.pendingPermission !== null;

  const allow = useCallback(
    () => resolvePermission({ behavior: 'allow' }),
    [resolvePermission],
  );
  const deny = useCallback(
    () =>
      resolvePermission({
        behavior: 'deny',
        message: 'Denied by operator.',
      }),
    [resolvePermission],
  );

  useKeyboard(
    useCallback(
      (key: KeyEvent) => {
        if (key.ctrl && key.name === 'c') {
          renderer.destroy();
          return;
        }
        // Shift+Tab flips plan ↔ build at any time.
        if (key.name === 'tab' && key.shift) {
          togglePermissionMode();
          return;
        }
        // While a permission is pending the input is blurred, so y/n/esc route
        // straight to the approval decision instead of into the textarea.
        if (hasPermission) {
          if (key.name === 'y') allow();
          else if (key.name === 'n' || key.name === 'escape') deny();
          return;
        }
        if (key.name === 'escape') interrupt();
      },
      [renderer, togglePermissionMode, hasPermission, allow, deny, interrupt],
    ),
  );

  return (
    <box style={{ flexDirection: 'column', height: '100%' }}>
      <SessionHeader view={view} />
      <StreamView transcript={view.transcript} />
      {view.pendingPermission !== null && (
        <PermissionPrompt request={view.pendingPermission} />
      )}
      <InputBox focused={!hasPermission} busy={isBusy} onSubmit={submit} />
      <FooterHints busy={isBusy} mode={view.permissionMode} />
    </box>
  );
}
