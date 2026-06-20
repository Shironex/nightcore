/**
 * @nightcore/engine — public façade.
 *
 * Surfaces import ONLY from here (plus `@nightcore/contracts` for types). The
 * SDK is never re-exported: `SessionManager` is the entire surface a client
 * needs to drive the engine via `SurfaceCommand`s and consume `NightcoreEvent`s.
 */
export { SessionManager } from './session-manager.js';
export { ToolRegistry } from './tool-registry.js';
export { PermissionLayer } from './permission-layer.js';
export type {
  PermissionPromptRequest,
  ApprovalDecision,
} from './permission-layer.js';
export { HookBus } from './hook-bus.js';
export { SessionRunner } from './session-runner.js';
export type { SessionRunnerConfig } from './session-runner.js';

// The message-translation boundary is exported for testing only — surfaces
// should not need it.
export { translateMessage } from './sdk-adapter.js';
export type { TranslateResult } from './sdk-adapter.js';
