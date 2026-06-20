import type {
  HookCallbackMatcher,
  HookEvent,
} from '@anthropic-ai/claude-agent-sdk';
import type { Logger } from '@nightcore/shared';

/**
 * Registers a small set of SDK hooks and re-emits them to local observers.
 * Skeleton for the foundation: it wires `PreToolUse` and `SessionStart` as
 * non-blocking observers (they always return an empty decision, never block).
 * Local plugins will later subscribe via `on()` to react to lifecycle events.
 */
export class HookBus {
  private readonly observers = new Set<(event: HookEvent, input: unknown) => void>();

  constructor(private readonly logger?: Logger) {}

  /** Subscribe to all observed hook events. Returns an unsubscribe fn. */
  on(observer: (event: HookEvent, input: unknown) => void): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  private emit(event: HookEvent, input: unknown): void {
    for (const observer of this.observers) {
      try {
        observer(event, input);
      } catch (error) {
        this.logger?.warn('hook observer threw', error);
      }
    }
  }

  /** The `hooks` map for SDK `Options`. Non-blocking: every callback returns an
   *  empty async output, so observation never alters the agent's behavior. */
  hooks(): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    const observe = (event: HookEvent): HookCallbackMatcher => ({
      hooks: [
        async (input) => {
          this.emit(event, input);
          return { continue: true };
        },
      ],
    });

    return {
      PreToolUse: [observe('PreToolUse')],
      SessionStart: [observe('SessionStart')],
    };
  }
}
