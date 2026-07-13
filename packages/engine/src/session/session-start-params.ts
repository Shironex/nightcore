/**
 * Resolve a `start-session` command + engine config into the provider-neutral
 * {@link StartSessionParams}, extracted from `SessionManager.startSession()`
 * (file-size ratchet; behavior verbatim). A pure data transform — no session
 * bookkeeping, no provider I/O — so the `?? config default` resolution and the
 * command's optional-field forwarding are testable in isolation.
 *
 * The supervisor resolves the plain `?? config default` knobs (model / effort /
 * cwd / turn+budget ceilings); the provider owns everything else (kind preset,
 * permission-mode precedence, the whole SDK-facing config assembly). This
 * function only forwards the command's runtime inputs verbatim (MCP servers,
 * context pack, harness policy, ledger path, OS sandbox request, resume id,
 * images, task kind).
 */
import type { Config, SurfaceCommand } from '@nightcore/contracts';

import type { StartSessionParams } from '../providers/agent-provider.js';

export function resolveStartSessionParams(
  id: number,
  command: Extract<SurfaceCommand, { type: 'start-session' }>,
  config: Config,
): StartSessionParams {
  const model = command.model ?? config.model;
  const effort = command.effort ?? config.effort;
  const cwd = command.cwd ?? process.cwd();
  const maxTurns = command.maxTurns ?? config.maxTurns;
  const maxBudgetUsd = command.maxBudgetUsd ?? config.maxBudgetUsd;

  return {
    sessionId: id,
    prompt: command.prompt,
    model,
    cwd,
    maxTurns,
    ...(command.images !== undefined ? { images: command.images } : {}),
    ...(effort !== undefined ? { effort } : {}),
    ...(command.autonomy !== undefined
      ? { autonomyOverride: command.autonomy }
      : {}),
    ...(command.kind !== undefined ? { kind: command.kind } : {}),
    ...(maxBudgetUsd !== undefined ? { maxBudgetUsd } : {}),
    ...(command.resumeSessionId !== undefined
      ? { resumeSessionId: command.resumeSessionId }
      : {}),
    ...(command.mcpServers !== undefined
      ? { mcpServers: command.mcpServers }
      : {}),
    ...(command.appendContextPack !== undefined
      ? { appendContextPack: command.appendContextPack }
      : {}),
    ...(command.harnessPolicy !== undefined
      ? { harnessPolicy: command.harnessPolicy }
      : {}),
    ...(command.ledgerPath !== undefined
      ? { ledgerPath: command.ledgerPath }
      : {}),
    ...(command.sandboxWrites !== undefined
      ? { sandboxWrites: command.sandboxWrites }
      : {}),
  };
}
