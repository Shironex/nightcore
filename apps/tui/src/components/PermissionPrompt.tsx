import type { ReactNode } from 'react';
import type { PendingPermission } from '../types.js';

interface PermissionPromptProps {
  request: PendingPermission;
}

function compactInput(input: Record<string, unknown>): string {
  const json = JSON.stringify(input);
  return json.length > 160 ? `${json.slice(0, 157)}…` : json;
}

/**
 * Inline approval card. Rendered whenever a `permission-required` event is
 * pending; the App owns the y/n/a keybindings that emit `approve-permission`.
 */
export function PermissionPrompt({
  request,
}: PermissionPromptProps): ReactNode {
  return (
    <box
      title="permission required"
      style={{
        border: true,
        borderColor: '#ffaf00',
        paddingLeft: 1,
        paddingRight: 1,
        flexDirection: 'column',
      }}
    >
      <text>
        <span fg="#ffaf00">⚠ </span>
        <span fg="#e4e4e4">
          {request.title ?? `Allow ${request.toolName}?`}
        </span>
      </text>
      <text fg="#777777">
        {request.toolName} {compactInput(request.input)}
      </text>
      <text>
        <span fg="#5faf5f">[y] allow</span>
        <span fg="#666666">   </span>
        <span fg="#ff5f5f">[n] deny</span>
        <span fg="#666666">   </span>
        <span fg="#888888">[esc] deny</span>
      </text>
    </box>
  );
}
