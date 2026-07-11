/** Status-to-style lookups for gauntlet/structure-lock step rows. */
import type { GauntletStep } from '@/lib/bridge';

/** Tailwind text class for a gauntlet step status (design palette). A `flaky`
 *  check passed on retry — a non-failure — so it reads as a warning, not an error. */
export const STEP_STATUS_TEXT: Record<GauntletStep['status'], string> = {
  passed: 'text-success',
  failed: 'text-destructive',
  skipped: 'text-muted-foreground',
  flaky: 'text-warning',
};

/** A short glyph for a step's status, for the leading status marker. */
export const STEP_STATUS_GLYPH: Record<GauntletStep['status'], string> = {
  passed: '✓',
  failed: '✕',
  skipped: '–',
  flaky: '~',
};
