import type { ReactNode } from 'react';
import type { NoticeTone, TranscriptEntry } from '../types.js';

interface StreamViewProps {
  transcript: TranscriptEntry[];
}

const NOTICE_COLOR: Record<NoticeTone, string> = {
  info: '#7f7f9f',
  success: '#5faf5f',
  error: '#ff5f5f',
};

function Entry({ entry }: { entry: TranscriptEntry }): ReactNode {
  switch (entry.kind) {
    case 'assistant':
      return <text fg="#e4e4e4">{entry.text}</text>;
    case 'tool-call':
      return (
        <text>
          <span fg="#5fafff">⚙ {entry.toolName}</span>
          <span fg="#666666"> {entry.input}</span>
        </text>
      );
    case 'tool-result':
      return (
        <text fg={entry.isError ? '#ff5f5f' : '#5faf5f'}>
          {entry.isError ? '  ↳ error: ' : '  ↳ '}
          {entry.content}
        </text>
      );
    case 'notice':
      return <text fg={NOTICE_COLOR[entry.tone]}>• {entry.text}</text>;
  }
}

/** Scrollable transcript. The reducer appends entries; `stickyScroll` keeps the
 *  newest output in view as the assistant streams. */
export function StreamView({ transcript }: StreamViewProps): ReactNode {
  return (
    <scrollbox
      focused={false}
      style={{ flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}
      stickyScroll
      stickyStart="bottom"
    >
      {transcript.length === 0 ? (
        <text fg="#555555">
          Type a prompt below and press Enter to start a session.
        </text>
      ) : (
        transcript.map((entry) => <Entry key={entry.id} entry={entry} />)
      )}
    </scrollbox>
  );
}
