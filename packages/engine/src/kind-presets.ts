/**
 * Per-kind agent presets (M4 §A, engine half).
 *
 * `@nightcore/contracts` owns the `TaskKind` enum; the Rust core owns each kind's
 * ORCHESTRATION policy (whether it gets a worktree, whether it is verified after).
 * This module owns the other half: a kind's AGENT DEFINITION — the system-prompt
 * append, the allowed/denied toolset, and the default permission mode that the
 * `SessionRunner` threads into the SDK `Options`.
 *
 * Agent identity is kept engine-side: the core never reaches into a preset and
 * the engine never decides orchestration.
 */
import type { PermissionMode, TaskKind } from '@nightcore/contracts';

/** The write tools a read-only reviewer must never be able to call. Denied for
 *  the `review` kind so a reviewer can inspect but not mutate the worktree. */
export const WRITE_TOOLS: readonly string[] = [
  'Edit',
  'Write',
  'NotebookEdit',
  'MultiEdit',
  'ApplyPatch',
] as const;

/**
 * The agent-definition half of a task kind. Every field is optional: an absent
 * field means "inherit the session default", so the `build` preset (all absent)
 * reproduces pre-M4 behavior byte-for-byte.
 */
export interface KindPreset {
  /** Appended to the session's system prompt (SDK `appendSystemPrompt`). */
  appendSystemPrompt?: string;
  /** Tools to explicitly allow (SDK `allowedTools`). */
  allowedTools?: string[];
  /** Tools to deny (SDK `disallowedTools`). */
  disallowedTools?: string[];
  /** A DEFAULT permission mode for the kind. An explicit `command.permissionMode`
   *  always wins over this — it is only consulted when the command omits one. */
  permissionMode?: PermissionMode;
}

/**
 * The reviewer's agent identity. The per-run instructions (which diff to read,
 * the base branch, the `VERDICT:` line format) are supplied by the Rust core as
 * the session prompt; this append establishes the read-only-judge persona and the
 * fail-closed discipline so the persona can't drift run to run.
 */
const REVIEWER_SYSTEM_PROMPT = [
  'You are an independent code reviewer. You did not write this code.',
  'You are READ-ONLY: you cannot edit, write, or apply patches — only inspect.',
  'Judge the changes for correctness and completeness against the stated task,',
  'then end your final message with exactly one machine-readable line:',
  '`VERDICT: PASS`, `VERDICT: CHANGES_REQUESTED`, or `VERDICT: FAIL`.',
  'If you are uncertain or cannot complete the review, return `VERDICT: FAIL`.',
].join(' ');

/**
 * Resolve a task kind to its agent preset. `build` (and the reserved
 * `research`/`decompose`) carry no overrides — they inherit every session
 * default, so M1–M3 runs are unchanged. Only `review` restricts the agent.
 */
export function resolveKindPreset(kind: TaskKind | undefined): KindPreset {
  switch (kind) {
    case 'review':
      return {
        appendSystemPrompt: REVIEWER_SYSTEM_PROMPT,
        disallowedTools: [...WRITE_TOOLS],
        // Verification is unattended; `dontAsk` never prompts. A tool that would
        // need a prompt is refused, so the reviewer can't hang the gate.
        permissionMode: 'dontAsk',
      };
    case 'build':
    case 'research':
    case 'decompose':
    case undefined:
      return {};
  }
}
