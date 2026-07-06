/** Props + view types for the ProviderIcon primitive. */
import type { ReactElement } from 'react';

import type { ProviderId } from '@nightcore/contracts';

/** The agent providers we ship an explicit brand glyph for. A superset of the
 *  providers Nightcore wires today (`claude`, `codex`); `gemini` is drawn ahead
 *  of its provider so the icon lands the moment the id is registered. Any other
 *  {@link ProviderId} falls back to a neutral generic mark. */
export type KnownProviderId = 'claude' | 'codex' | 'gemini';

/** Props for a single brand glyph — the inline SVG marks in
 *  `ProviderIcon.glyphs`. Kept minimal (size/className/label) so a glyph is a
 *  drop-in `currentColor` icon like the rest of the `icons.tsx` set. */
export interface ProviderGlyphProps {
  /** Rendered width/height in px. Defaults to 16 (inline text size). */
  size?: number;
  className?: string;
  /** Accessible label; each glyph provides its own brand-name default. */
  label?: string;
}

/** A brand glyph component: a pure, stateless `currentColor` SVG mark. */
export type ProviderGlyph = (props: ProviderGlyphProps) => ReactElement;

/** Props for {@link ProviderIcon} — the public, provider-driven brand mark. */
export interface ProviderIconProps {
  /** The provider whose brand mark to render — a contract {@link ProviderId}
   *  (an open lowercase slug, resolved brand-first with an alias fallback). */
  provider: ProviderId;
  /** Rendered width/height in px. Defaults to 16 (inline text size). */
  size?: number;
  className?: string;
  /** Accessible-label override; defaults to the provider's display name. */
  title?: string;
}
