/** @deprecated (B5) — migrated to `ModelSelectField` / `ModelSelect`. This is a
 *  thin adapter kept for ONE deprecation cycle: it maps the old
 *  `model`/`effort`/`onChangeModel`/`onChangeEffort` prop API onto the live-wired
 *  combobox so any lingering caller keeps working, then it is deleted. New surfaces
 *  render `<ModelSelectField value onChange />` directly. */
import { ModelSelectField } from '../ModelSelectField';
import type { ModelEffortPickerProps } from './ModelEffortPicker.types';

/**
 * @deprecated Use {@link ModelSelectField} (or the presentational
 * {@link import('../ModelSelect').ModelSelect}). This adapter delegates to
 * `ModelSelectField`, translating the old two-callback API into the single
 * `ModelSelection` `onChange` — firing `onChangeModel`/`onChangeEffort` only for the
 * field that actually changed, so the prior "set-on-change" semantics (including the
 * effort→Inherit reconciliation on an unsupported model switch) are preserved.
 */
export function ModelEffortPicker({
  model,
  effort,
  onChangeModel,
  onChangeEffort,
  disabled = false,
}: ModelEffortPickerProps) {
  return (
    <ModelSelectField
      value={{ model, effort }}
      disabled={disabled}
      onChange={(next) => {
        if (next.model !== model) onChangeModel(next.model);
        if (next.effort !== effort) onChangeEffort(next.effort);
      }}
    />
  );
}
