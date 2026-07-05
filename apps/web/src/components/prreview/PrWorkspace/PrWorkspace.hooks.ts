/** Presentation helpers + collapse state for the PR workspace panel. */
import type { CSSProperties } from 'react';
import { useState } from 'react';

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

/** Bodies longer than this collapse by default (untrusted contributor markdown
 *  shouldn't shove the review section below the fold). */
const COLLAPSE_THRESHOLD = 700;

export interface DescriptionCollapse {
  /** True when the body is long enough to collapse at all. */
  collapsible: boolean;
  /** True when the full body is currently shown. */
  expanded: boolean;
  toggle: () => void;
}

/** Collapse state for the PR description. Keyed by PR number so switching PRs
 *  returns to the collapsed default without any effect/remount choreography. */
export function useDescriptionCollapse(
  prNumber: number,
  body: string,
): DescriptionCollapse {
  const collapsible = body.trim().length > COLLAPSE_THRESHOLD;
  const [expandedFor, setExpandedFor] = useState<number | null>(null);
  const expanded = !collapsible || expandedFor === prNumber;
  return {
    collapsible,
    expanded,
    toggle: () => setExpandedFor(expanded ? null : prNumber),
  };
}
