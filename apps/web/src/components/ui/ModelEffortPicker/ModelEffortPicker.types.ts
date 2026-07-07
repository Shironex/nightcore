/** Public types for the ModelEffortPicker component. */

/**
 * Props for the ModelEffortPicker component.
 *
 * @deprecated (B5) — the ModelEffortPicker is a thin adapter over
 * `ModelSelectField` kept for one deprecation cycle. New surfaces should render
 * `<ModelSelectField value onChange />` (the single-`ModelSelection` API) directly.
 */
export interface ModelEffortPickerProps {
  /** The current model id override, or `null` to inherit the default. */
  model: string | null;
  /** The current reasoning-effort override, or `null` to inherit the default. */
  effort: string | null;
  /** Fired when the user picks a model (or the Inherit option, `null`). */
  onChangeModel: (model: string | null) => void;
  /** Fired when the user picks an effort level (or the Inherit option, `null`). */
  onChangeEffort: (effort: string | null) => void;
  /** Disable the whole control (e.g. once a task has started running). */
  disabled?: boolean;
}
