/** Pure presentation helpers for the PR Review detail pane. */
import type { CSSProperties } from 'react';

/** A GitHub label color is a 6-hex string with no `#`. Validate before use so an
 *  unexpected value can never become raw CSS. */
export function labelChipStyle(color: string): CSSProperties {
  if (!/^[0-9a-fA-F]{6}$/.test(color)) {
    return {}; // fall back to the neutral chip classes
  }
  return {
    backgroundColor: `#${color}22`,
    borderColor: `#${color}66`,
    color: `#${color}`,
  };
}

/** Format a gh ISO-8601 timestamp as a short local date (e.g. "Apr 9, 2026"), or
 *  null when it can't be parsed (so the caller can omit it). */
export function formatPrDate(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
