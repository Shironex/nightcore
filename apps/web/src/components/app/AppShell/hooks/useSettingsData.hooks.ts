import { useCallback, useState } from 'react';
import { getSettings, updateSettings, type Settings, type SettingsPatch } from '@/lib/bridge';
import type { ToastApi } from '@/components/ui';
import { useAsyncData } from './useAsyncData.hooks';

/** Live settings, kept in memory and patched through `update_settings`. */
export function useSettingsData(toast: ToastApi) {
  const [settings, setSettings] = useState<Settings | null>(null);

  useAsyncData(
    () =>
      getSettings().catch((err) => {
        console.error('get_settings failed', err);
        toast.error('Could not load settings', err);
        return null;
      }),
    (loaded) => {
      if (loaded !== null) setSettings(loaded);
    },
  );

  const update = useCallback(
    (patch: SettingsPatch) => {
      void updateSettings(patch)
        .then(setSettings)
        .catch((err) => {
          console.error('update_settings failed', err);
          // The control snaps back to the last-saved value on failure; surface it
          // so the change isn't silently lost.
          toast.error('Could not save settings', err);
        });
    },
    [toast],
  );

  return { settings, update };
}
