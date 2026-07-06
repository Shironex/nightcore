/** Brand mark for an agent provider. A thin, stateless shell: it resolves the
 *  provider id to a `currentColor` brand glyph (contract-first, alias-aware) and
 *  renders it with an accessible name. Tint it via a text color at the call site
 *  (`text-primary`, `text-muted-foreground`, …), like the rest of the icon set. */
import { providerGlyphFor, providerLabel } from './ProviderIcon.resolve';
import type { ProviderIconProps } from './ProviderIcon.types';

export function ProviderIcon({ provider, size, className, title }: ProviderIconProps) {
  const Glyph = providerGlyphFor(provider);
  const label = title ?? providerLabel(provider);
  return <Glyph size={size} className={className} label={label} />;
}
