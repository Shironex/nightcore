/** Props for the PostCommentDialog — the human gate on posting a validation verdict
 *  to GitHub. It shows the EXACT markdown that will be posted (fetched via
 *  `previewIssueComment`, byte-identical to the post), and the Post button is disabled
 *  until the user confirms the preview. Nothing ever posts automatically. */
export interface PostCommentDialogProps {
  /** Presence flag — the dialog animates in/out. Keep it always-mounted. */
  open: boolean;
  /** The exact comment markdown that will be posted (empty while loading). */
  body: string;
  /** True while the preview is being built. */
  loading: boolean;
  /** A preview-build or post failure, or `null`. */
  error: string | null;
  /** True while the post is in flight. */
  posting: boolean;
  onClose: () => void;
  /** Post the comment — only reachable after the user confirms the preview. */
  onPost: () => void;
}
