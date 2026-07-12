import type { ConventionCategory } from '@/lib/bridge';
import type { RunConfig, RunConfigPrefill } from '@/lib/useRunConfig';

/**
 * The lifted Harness run-config: the shared {@link RunConfig} (model/effort/lens
 * selection) plus the opt-in DEEP scan mode (issue #294) that is Harness-specific.
 * Owned by the HarnessView hook (via `useRunConfig`) so it survives the CONFIGURE →
 * RUNNING → RESULTS phase swaps and pre-fills on a new run. `RunControls` is a
 * controlled, purely-presentational form that renders this. Mirrors Insight's
 * `InsightRunConfig` (minus scope — Harness always scans the whole repo).
 */
export interface HarnessRunConfig
  extends Omit<RunConfig<ConventionCategory>, 'prefill'> {
  /** Opt-in DEEP scan mode (issue #294): multi-round convergence loop per lens instead
   *  of one pass. Defaults `false`; never carried across "New run" pre-fill — each run
   *  starts from the classic single-pass mode. */
  deep: boolean;
  setDeep: (deep: boolean) => void;
  prefill: (opts: RunConfigPrefill<ConventionCategory>) => void;
}

export interface RunControlsProps {
  /** The lifted run config, owned by the HarnessView hook. Carries model/effort/lens
   *  selection, the DEEP toggle, and the run gate. */
  config: HarnessRunConfig;
  /** True while the scan dispatch is in flight (Starting…). */
  isStarting: boolean;
  /** Launch the scan with the current config (≥1 lens required — gated by
   *  `config.canRun`). */
  onScan: () => void;
}
