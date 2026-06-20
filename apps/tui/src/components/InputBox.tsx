import { useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import type { TextareaRenderable } from '@opentui/core';

interface InputBoxProps {
  focused: boolean;
  busy: boolean;
  onSubmit: (text: string) => void;
}

/**
 * Multi-line prompt input. Enter submits the current buffer; Shift+Enter inserts
 * a newline (the textarea's native behaviour). The buffer is cleared on submit
 * via the renderable ref so the controlled-vs-uncontrolled dance stays simple.
 */
export function InputBox({
  focused,
  busy,
  onSubmit,
}: InputBoxProps): ReactNode {
  const ref = useRef<TextareaRenderable | null>(null);

  const handleSubmit = useCallback(() => {
    const node = ref.current;
    if (node === null) return;
    const text = node.plainText;
    if (text.trim().length === 0) return;
    onSubmit(text);
    node.clear();
  }, [onSubmit]);

  return (
    <box style={{ flexDirection: 'column' }}>
      <box
        title={busy ? 'follow-up' : 'prompt'}
        style={{
          border: true,
          borderColor: focused ? '#5fafff' : '#333344',
          height: 5,
        }}
      >
        <textarea
          ref={ref}
          focused={focused}
          placeholder={
            busy ? 'Send more input…' : 'Ask Nightcore anything…'
          }
          onSubmit={handleSubmit}
        />
      </box>
    </box>
  );
}
