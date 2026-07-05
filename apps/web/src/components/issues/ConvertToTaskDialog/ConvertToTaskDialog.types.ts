/** Props for the ConvertToTaskDialog — the confirmation for minting a board task from
 *  a validation verdict. It previews the task (title, suggested kind, complexity→effort
 *  sizing) and notes that the verdict is embedded as a warning-framed untrusted block
 *  with a `sourceRef` back to the validation. Idempotent: an already-linked validation
 *  offers "Go to task" instead. */
export interface ConvertToTaskDialogProps {
  /** Presence flag — the dialog animates in/out. Keep it always-mounted. */
  open: boolean;
  /** The issue number, or `null`. */
  issueNumber: number | null;
  /** The issue title (becomes the task title; untrusted GitHub text). */
  issueTitle: string;
  /** The board task kind the convert will mint (mirrors the Rust `task_kind_for`). */
  suggestedKind: 'Build' | 'Decompose';
  /** The estimated-complexity label, or `null` when the model gave none. */
  complexityLabel: string | null;
  /** The board effort the complexity maps to, or `null`. Informational sizing. */
  effortLabel: string | null;
  /** True while the convert command is in flight. */
  converting: boolean;
  /** True when the validation already links a task — offer "Go to task", not convert. */
  alreadyLinked: boolean;
  /** A convert failure, or `null`. */
  error: string | null;
  onClose: () => void;
  onConvert: () => void;
  /** Navigate to the linked task on the board. */
  onGotoBoard?: () => void;
}
