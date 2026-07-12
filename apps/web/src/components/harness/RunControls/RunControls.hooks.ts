import { useState } from 'react';

import type { ConventionCategory } from '@/lib/bridge';
import { useRunConfig as useSharedRunConfig } from '@/lib/useRunConfig';

import { ALL_CATEGORIES } from '../harness.constants';
import type { HarnessRunConfig } from './RunControls.types';

/**
 * Own the Harness run-config: the shared run-config (model/effort/lens selection)
 * bound to the convention lenses, plus the opt-in DEEP mode (issue #294).
 * Instantiated by the HarnessView hook (not by `RunControls`) so the state lives
 * ABOVE the form and survives the CONFIGURE → RUNNING → RESULTS phase swaps and
 * pre-fills on "New run". Harness always scans the whole repo, so unlike Insight there
 * is no `scope` to add.
 *
 * @param disabled when true (e.g. no active project), Scan is never permitted.
 */
export function useRunConfig(disabled: boolean): HarnessRunConfig {
  const base = useSharedRunConfig<ConventionCategory>(ALL_CATEGORIES, disabled);
  const [deep, setDeep] = useState(false);

  return {
    ...base,
    deep,
    setDeep,
    prefill: (opts) => {
      // Deep is a deliberate, session-local opt-in — a "New run" reconfigure always
      // resets it, so a long/expensive deep pass never silently sticks unnoticed.
      setDeep(false);
      base.prefill(opts);
    },
  };
}
