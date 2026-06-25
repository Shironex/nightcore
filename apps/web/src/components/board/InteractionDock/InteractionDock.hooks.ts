import type { PermissionPrompt, QuestionPrompt } from '@/lib/bridge';

/** Total parked interactions across both prompt families — drives the dock's count
 *  badge and its render-or-hide decision (zero ⇒ the dock is absent entirely). */
export function interactionCount(
  permissionPrompts: PermissionPrompt[],
  questionPrompts: QuestionPrompt[],
): number {
  return permissionPrompts.length + questionPrompts.length;
}
