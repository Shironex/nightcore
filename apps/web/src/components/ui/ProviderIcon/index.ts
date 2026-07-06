/** Public surface for the ProviderIcon primitive. */
export { ProviderIcon } from './ProviderIcon';
export { PROVIDER_GLYPHS } from './ProviderIcon.glyphs';
export {
  getProviderIconForModel,
  inferProviderFromModel,
  knownProviderFrom,
  providerGlyphFor,
  providerLabel,
  resolveProviderForModel,
} from './ProviderIcon.resolve';
export type {
  KnownProviderId,
  ProviderGlyph,
  ProviderGlyphProps,
  ProviderIconProps,
} from './ProviderIcon.types';
