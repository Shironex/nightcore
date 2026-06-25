import type {
  PermissionPrompt,
  QuestionAnswer,
  QuestionPrompt,
} from '@/lib/bridge';

export interface InteractionDockProps {
  /** The task whose parked interactions this dock surfaces. */
  taskId: string;
  /** Parked permission prompts for the task (interactive allow/deny). */
  permissionPrompts: PermissionPrompt[];
  /** Parked AskUserQuestion prompts for the task (pick/answer). */
  questionPrompts: QuestionPrompt[];
  /** Relay a permission decision up to the board. */
  onRespondPermission: (
    taskId: string,
    requestId: string,
    decision: 'allow' | 'deny',
  ) => void;
  /** Relay a question answer up to the board. */
  onAnswerQuestion: (
    taskId: string,
    requestId: string,
    answer: QuestionAnswer,
  ) => void;
}
