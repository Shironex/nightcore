import type { QuestionAnswer, QuestionPrompt as QuestionPromptData } from '@/lib/bridge';

export interface QuestionPromptProps {
  /** The parked AskUserQuestion prompt to render (1–4 questions). */
  prompt: QuestionPromptData;
  /** Answer the prompt: submit the chosen/typed answers, or `cancel` to skip. */
  onAnswer: (requestId: string, answer: QuestionAnswer) => void;
}
