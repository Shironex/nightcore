import type { PermissionPolicy } from '@nightcore/contracts';
import { createRequestIdFactory, type Logger } from '@nightcore/shared';
import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';

/**
 * A pending interactive approval. The PermissionLayer hands the request out to
 * the surface (via `onPrompt`) and parks a promise resolver keyed by requestId;
 * the SessionRunner resolves it when an `approve-permission` command arrives.
 */
interface PendingApproval {
  resolve: (result: PermissionResult) => void;
}

export interface PermissionPromptRequest {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  title?: string;
}

/** Decision the surface sends back for a pending approval. */
export type ApprovalDecision =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string };

/**
 * Implements the SDK's `canUseTool` callback. Resolution order per request:
 *   1. explicit deny list  → deny immediately
 *   2. explicit allow list → allow immediately
 *   3. otherwise           → emit `permission-required` and await the surface
 *
 * Note: this layer is the harness-level policy gate. The SDK's own
 * `permissionMode` (plan / acceptEdits / bypassPermissions / …) still applies
 * underneath; `canUseTool` is only consulted for calls the mode would prompt on.
 */
export class PermissionLayer {
  private readonly pending = new Map<string, PendingApproval>();
  private readonly nextRequestId = createRequestIdFactory('perm');

  constructor(
    private readonly policy: PermissionPolicy,
    private readonly onPrompt: (req: PermissionPromptRequest) => void,
    private readonly logger?: Logger,
  ) {}

  /** The callback wired into the SDK `query()` options. */
  readonly canUseTool: CanUseTool = async (toolName, input, options) => {
    if (this.policy.deny.includes(toolName)) {
      return {
        behavior: 'deny',
        message: `Tool "${toolName}" is denied by Nightcore policy.`,
      };
    }
    if (this.policy.allow.includes(toolName)) {
      return { behavior: 'allow', updatedInput: input };
    }

    const requestId = this.nextRequestId();
    this.logger?.debug('awaiting interactive approval', { requestId, toolName });

    return new Promise<PermissionResult>((resolve) => {
      this.pending.set(requestId, { resolve });

      // If the SDK aborts the query while we're parked, settle as a deny so the
      // promise never dangles (mirrors degrade-not-throw).
      options.signal.addEventListener(
        'abort',
        () => this.settleAborted(requestId),
        { once: true },
      );

      this.onPrompt({ requestId, toolName, input, title: options.title });
    });
  };

  /** Resolve a parked approval from a surface `approve-permission` command.
   *  Returns false if the requestId is unknown (already settled / stale). */
  resolve(requestId: string, decision: ApprovalDecision): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    this.pending.delete(requestId);
    entry.resolve(
      decision.behavior === 'allow'
        ? { behavior: 'allow', updatedInput: decision.updatedInput }
        : { behavior: 'deny', message: decision.message },
    );
    return true;
  }

  /** Deny every pending approval — used when the session tears down so no SDK
   *  control request is left hanging. */
  failAllPending(): void {
    for (const [requestId, entry] of this.pending) {
      entry.resolve({
        behavior: 'deny',
        message: 'Session ended before approval was granted.',
      });
      this.logger?.debug('failed pending approval on teardown', { requestId });
    }
    this.pending.clear();
  }

  private settleAborted(requestId: string): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    this.pending.delete(requestId);
    entry.resolve({ behavior: 'deny', message: 'Aborted.' });
  }
}
