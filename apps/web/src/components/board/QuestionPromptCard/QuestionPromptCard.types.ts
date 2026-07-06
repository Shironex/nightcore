/** Prop types for the QuestionPromptCard component. */
import type { QuestionAnswer, QuestionPrompt as QuestionPromptData } from '@/lib/bridge';

/** Props for `QuestionPromptCard`. */
export interface QuestionPromptCardProps {
  /** The parked AskUserQuestion prompt to render (1–4 questions). */
  prompt: QuestionPromptData;
  /** Answer the prompt: submit the chosen/typed answers, or `cancel` to skip. */
  onAnswer: (requestId: string, answer: QuestionAnswer) => void;
}
