/** Provider-icon resolution — pure, presentation-only helpers. The rule is
 *  "contract {@link ProviderId} FIRST": an explicitly-known provider always wins,
 *  and the model-family heuristic is only a fallback for model ids whose provider
 *  is not explicitly known (e.g. a per-task model with no provider context). */
import type { ProviderId } from '@nightcore/contracts';

import { FallbackGlyph, PROVIDER_GLYPHS } from './ProviderIcon.glyphs';
import type { KnownProviderId, ProviderGlyph } from './ProviderIcon.types';

/** Display names for the providers we ship a dedicated glyph for. */
const KNOWN_PROVIDER_LABELS: Record<KnownProviderId, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
};

/** Provider-slug aliases → the canonical {@link KnownProviderId} we ship a glyph
 *  for. Lets a provider registered under a vendor name (`openai`, `anthropic`,
 *  `google`) still resolve to a brand mark. Keyed lowercase. */
const PROVIDER_ALIASES: Record<string, KnownProviderId> = {
  claude: 'claude',
  anthropic: 'claude',
  codex: 'codex',
  openai: 'codex',
  'open-ai': 'codex',
  chatgpt: 'codex',
  gemini: 'gemini',
  'google-gemini': 'gemini',
  google: 'gemini',
  palm: 'gemini',
};

/** Model-family heuristics — matched only when the provider is not explicitly
 *  known. Ordered claude → codex → gemini; the families are disjoint so order is
 *  informational. The OpenAI o-series (`o1`/`o3`/`o4`) is matched at a boundary so
 *  it can't trip on an unrelated substring. */
const MODEL_FAMILY_PATTERNS: readonly [RegExp, KnownProviderId][] = [
  [/claude|opus|sonnet|haiku|fable|anthropic/, 'claude'],
  [/gpt|codex|chatgpt|davinci|openai|(?:^|[^a-z])o[134](?:-|$)/, 'codex'],
  [/gemini|palm|bison|gemma|google/, 'gemini'],
];

/** Resolve a provider slug (or alias) to a {@link KnownProviderId}, or `null`
 *  when it maps to no brand glyph. Pure. */
export function knownProviderFrom(
  provider: ProviderId | null | undefined,
): KnownProviderId | null {
  if (provider === null || provider === undefined) return null;
  return PROVIDER_ALIASES[provider.toLowerCase()] ?? null;
}

/** Infer the provider from a model id by family heuristic, or `null` when no
 *  family matches. Pure — a best-effort hint, never authoritative. */
export function inferProviderFromModel(model: string): KnownProviderId | null {
  const normalized = model.toLowerCase();
  for (const [pattern, provider] of MODEL_FAMILY_PATTERNS) {
    if (pattern.test(normalized)) return provider;
  }
  return null;
}

/** The provider a model belongs to: the explicitly-known `provider` FIRST, then a
 *  model-family fallback, else `null`. Pure. */
export function resolveProviderForModel(
  model: string | null | undefined,
  provider?: ProviderId | null,
): KnownProviderId | null {
  const known = knownProviderFrom(provider);
  if (known !== null) return known;
  if (model === null || model === undefined || model === '') return null;
  return inferProviderFromModel(model);
}

/** The brand glyph for a provider id (contract-first, alias-aware), falling back
 *  to the neutral mark for an unknown provider. Pure. */
export function providerGlyphFor(provider: ProviderId | null | undefined): ProviderGlyph {
  const known = knownProviderFrom(provider);
  return known !== null ? PROVIDER_GLYPHS[known] : FallbackGlyph;
}

/** The brand glyph for a model id — provider FIRST, then the model-family
 *  fallback, else the neutral mark. This is the primary entry point for callers
 *  that have a model but only sometimes a provider context. Pure. */
export function getProviderIconForModel(
  model: string | null | undefined,
  provider?: ProviderId | null,
): ProviderGlyph {
  const resolved = resolveProviderForModel(model, provider);
  return resolved !== null ? PROVIDER_GLYPHS[resolved] : FallbackGlyph;
}

/** Human display name for a provider id — the known brand name for an exact
 *  known id, else a title-cased slug so an unknown provider still reads well as
 *  an accessible label. Pure. */
export function providerLabel(provider: ProviderId): string {
  const lower = provider.toLowerCase();
  if (lower in KNOWN_PROVIDER_LABELS) {
    return KNOWN_PROVIDER_LABELS[lower as KnownProviderId];
  }
  const words = provider.replace(/[-_]+/g, ' ').trim();
  return words.length > 0 ? words.charAt(0).toUpperCase() + words.slice(1) : provider;
}
