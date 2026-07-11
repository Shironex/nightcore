/** Public types for the FixDiffPreview component. */
import type { WorktreeDiff } from '@/lib/bridge';

export interface FixDiffPreviewProps {
  /** The fix whose local commit diff to preview. */
  fixId: string;
  /** The changed-file list fetcher — defaults to the real `prFixDiff` bridge
   *  command; injectable so stories/tests can render a populated diff without a
   *  Tauri backend. */
  fetchDiff?: (fixId: string) => Promise<WorktreeDiff>;
  /** The per-file patch fetcher — defaults to the real `prFixFileDiff` bridge
   *  command; injected alongside `fetchDiff` in stories/tests. */
  fetchPatch?: (fixId: string, path: string) => Promise<string>;
}
