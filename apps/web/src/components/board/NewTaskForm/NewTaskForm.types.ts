/** Props for the NewTaskForm dialog. */
import type { CreateTaskOptions, RunMode, TaskKind } from '@/lib/bridge';

/** Props for the create-task dialog: the create callback (title, description,
 *  kind, run mode, plus optional overrides) and the close handler. */
export interface NewTaskFormProps {
  /** Presence flag — the sheet slides in/out and stays mounted while closed. */
  open: boolean;
  /** Plan-approval gate (T6, #147): the studio-wide default that seeds the "Plan
   *  first" toggle for a Build task. When on, a fresh Build task defaults to
   *  planning before it writes code. */
  planGateDefault: boolean;
  onCreate: (
    title: string,
    description: string,
    kind: TaskKind,
    runMode: RunMode,
    options?: CreateTaskOptions,
  ) => Promise<void>;
  onClose: () => void;
}
