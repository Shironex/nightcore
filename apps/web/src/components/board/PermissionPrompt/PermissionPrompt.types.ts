import type { PermissionPrompt as PermissionPromptData } from '@/lib/bridge';

export interface PermissionPromptProps {
  /** The parked prompt to render (tool + input). */
  prompt: PermissionPromptData;
  /** Answer the prompt. `decision` is `allow` or `deny`. */
  onRespond: (requestId: string, decision: 'allow' | 'deny') => void;
}
