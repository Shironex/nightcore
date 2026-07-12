/** Terminal settings cards — split from settings-interface-cards (which now covers
 *  sidebar layout only) into its own page, mirroring settings-github-cards. The
 *  "Skip Claude permissions (YOLO)" row moved OUT to the Permissions page — it's a
 *  security/governance control, not a rendering preference. */
import { NumberField, TerminalIcon, Toggle } from '@/components/ui';
import type { Settings, SettingsPatch } from '@/lib/bridge';

import type { SettingsCardProps } from './SettingsCard';

// Clamp bounds for the two terminal render prefs (spec PR 3d). Mirrors the terminal
// feature's own resolver (which re-clamps on apply) — kept inline here so a settings
// card never cross-feature-imports the terminal module. Font size in px; scrollback
// in lines.
const TERMINAL_FONT_SIZE = { min: 8, max: 32, default: 13 } as const;
const TERMINAL_SCROLLBACK = { min: 1_000, max: 100_000, default: 10_000 } as const;

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Build the Terminal page cards: rendering, sizing, naming, and PTY-survival prefs. */
export function buildTerminalCards(
  settings: Settings,
  patchGlobal: (patch: SettingsPatch) => void,
): SettingsCardProps[] {
  return [
    {
      icon: <TerminalIcon size={18} />,
      title: 'Terminal',
      subtitle: 'How the integrated terminal renders its output.',
      rows: [
        {
          label: 'GPU rendering (WebGL)',
          hint: 'Use the GPU to draw the terminal. Off by default (standard DOM rendering); a lost GPU context falls back automatically.',
          control: (
            <Toggle
              on={settings.terminalWebglEnabled}
              onChange={(next) => patchGlobal({ terminalWebglEnabled: next })}
              label="GPU rendering (WebGL)"
            />
          ),
        },
        {
          label: 'Font size',
          hint: 'Terminal text size in pixels (empty = default 13). Applies to open terminals live.',
          control: (
            <NumberField
              value={settings.terminalFontSize}
              placeholder={String(TERMINAL_FONT_SIZE.default)}
              min={TERMINAL_FONT_SIZE.min}
              step="1"
              ariaLabel="Terminal font size in pixels"
              onCommit={(n) =>
                patchGlobal({
                  terminalFontSize: clampInt(n, TERMINAL_FONT_SIZE.min, TERMINAL_FONT_SIZE.max),
                })
              }
            />
          ),
        },
        {
          label: 'Scrollback',
          hint: 'Lines of history kept per terminal (empty = default 10,000). Applies to new output.',
          control: (
            <NumberField
              value={settings.terminalScrollback}
              placeholder={String(TERMINAL_SCROLLBACK.default)}
              min={TERMINAL_SCROLLBACK.min}
              step="1000"
              ariaLabel="Terminal scrollback length in lines"
              onCommit={(n) =>
                patchGlobal({
                  terminalScrollback: clampInt(
                    n,
                    TERMINAL_SCROLLBACK.min,
                    TERMINAL_SCROLLBACK.max,
                  ),
                })
              }
            />
          ),
        },
        {
          label: 'Auto-name terminal tabs',
          hint: 'Uses a sandboxed claude haiku on the last command to suggest a short tab title after you run something. Off by default. A tab you rename yourself — or link to a task — keeps that name; the AI never overwrites it.',
          control: (
            <Toggle
              on={settings.terminalAiNaming}
              onChange={(next) => patchGlobal({ terminalAiNaming: next })}
              label="Auto-name terminal tabs from the last command"
            />
          ),
        },
        {
          label: 'Live-PTY survival (experimental)',
          hint: 'EXPERIMENTAL, macOS/Linux only. Runs your shells in a detached background process so they keep running when you quit and reattach (replaying their output) on relaunch, instead of a read-only restore. Off by default; takes effect on the next relaunch. On other platforms this has no effect. Confined (sandboxed) tabs never survive.',
          control: (
            <Toggle
              on={settings.terminalDaemonEnabled}
              onChange={(next) => patchGlobal({ terminalDaemonEnabled: next })}
              label="Keep terminals running across app restarts (experimental)"
            />
          ),
        },
      ],
    },
  ];
}
