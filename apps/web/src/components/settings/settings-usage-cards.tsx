/** Usage settings cards (AUTOMATION group) — split from settings-cards to stay under
 *  the file-size ratchet, mirroring settings-github-cards. Fixes the usage-meter
 *  dead end: `disableUsageMeter` was exposed on the bridge but had zero web call
 *  sites, so an opted-in user had no way to opt back out. The toggle here calls the
 *  real `enable`/`disable` commands (Keychain-read + poll-arm / kick-and-park side
 *  effects, not just a settings-file flag) and mirrors the result into the
 *  persisted `usageMeterEnabled` field so every other reader (the board-header gear,
 *  the sidebar widget) sees the change immediately. The sidebar UsageMeter widget
 *  keeps its own "Enable" affordance as a shortcut into this same setting. */
import { NumberField, PerfIcon, Toggle } from '@/components/ui';
import { disableUsageMeter, enableUsageMeter, type Settings, type SettingsPatch } from '@/lib/bridge';

import type { SettingsCardProps } from './SettingsCard';

/** Clamp the throttle to its 50..=100 window (mirrors the Rust patch-merge clamp and
 *  the board-header gear's own slider) so a stray commit can never persist out of range. */
function clampThreshold(n: number): number {
  return Math.min(100, Math.max(50, Math.round(n)));
}

/** Toggle the usage meter: fires the real enable/disable command for its side
 *  effects (Keychain read + poll-arm on enable, kick + park on disable), then mirrors
 *  the flag into Settings so it's reflected everywhere else that reads it. */
function toggleUsageMeter(next: boolean, patchGlobal: (patch: SettingsPatch) => void): void {
  void (next ? enableUsageMeter() : disableUsageMeter())
    .then(() => patchGlobal({ usageMeterEnabled: next }))
    .catch((err) => {
      console.error(`${next ? 'enable' : 'disable'}_usage_meter failed`, err);
    });
}

/** Build the Usage page cards: the meter opt-in/out + the Auto-Mode pause threshold. */
export function buildUsageCards(
  settings: Settings,
  patchGlobal: (patch: SettingsPatch) => void,
): SettingsCardProps[] {
  return [
    {
      icon: <PerfIcon size={18} />,
      title: 'Provider usage meter',
      subtitle: 'Read-only rate-limit visibility for the sidebar and Auto Mode.',
      rows: [
        {
          label: 'Usage meter',
          hint: 'Reads OAuth credentials to show Claude/Codex rate-limit windows (read-only; may prompt for Keychain access). Off by default.',
          control: (
            <Toggle
              on={settings.usageMeterEnabled}
              onChange={(next) => toggleUsageMeter(next, patchGlobal)}
              label="Enable provider usage meter"
            />
          ),
        },
        {
          label: 'Pause Auto Mode at usage (%)',
          hint: settings.usageMeterEnabled
            ? 'When any rate-limit window reaches this level, Auto Mode stops picking up new runs until usage cools. Range 50–100, default 90.'
            : 'Enable the usage meter above to use this.',
          control: (
            <NumberField
              value={settings.autoPauseUsageThreshold}
              placeholder="90"
              min={50}
              step="1"
              ariaLabel="Pause Auto Mode at usage threshold (percent)"
              onCommit={(n) => patchGlobal({ autoPauseUsageThreshold: clampThreshold(n) })}
            />
          ),
        },
      ],
    },
  ];
}
