import { composeStories } from '@storybook/react-vite';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import { PROVIDER_GLYPHS } from './ProviderIcon.glyphs';
import {
  getProviderIconForModel,
  inferProviderFromModel,
  knownProviderFrom,
  providerGlyphFor,
  providerLabel,
  resolveProviderForModel,
} from './ProviderIcon.resolve';
import * as stories from './ProviderIcon.stories';

const { Claude, Codex, Gemini, VendorAlias, UnknownProvider, LargeWithTitle } =
  composeStories(stories);

// --- Rendering ------------------------------------------------------------

test('renders each provider brand mark as a named image', async () => {
  const claude = render(<Claude />);
  await expect.element(claude.getByRole('img', { name: /claude/i })).toBeInTheDocument();
  const codex = render(<Codex />);
  await expect.element(codex.getByRole('img', { name: /codex/i })).toBeInTheDocument();
  const gemini = render(<Gemini />);
  await expect.element(gemini.getByRole('img', { name: /gemini/i })).toBeInTheDocument();
});

test('a vendor alias renders the canonical brand mark', async () => {
  const screen = render(<VendorAlias />);
  // `openai` aliases to the `codex` glyph.
  await expect.element(screen.getByRole('img')).toBeInTheDocument();
});

test('an unknown provider renders the fallback mark labeled from its slug', async () => {
  const screen = render(<UnknownProvider />);
  await expect.element(screen.getByRole('img', { name: /mistral/i })).toBeInTheDocument();
});

test('the title prop overrides the accessible name', async () => {
  const screen = render(<LargeWithTitle />);
  await expect
    .element(screen.getByRole('img', { name: 'Anthropic Claude' }))
    .toBeInTheDocument();
});

// --- knownProviderFrom (contract-first, alias-aware) ----------------------

test('knownProviderFrom resolves ids and aliases, else null', () => {
  expect(knownProviderFrom('claude')).toBe('claude');
  expect(knownProviderFrom('codex')).toBe('codex');
  expect(knownProviderFrom('gemini')).toBe('gemini');
  expect(knownProviderFrom('anthropic')).toBe('claude');
  expect(knownProviderFrom('openai')).toBe('codex');
  expect(knownProviderFrom('google')).toBe('gemini');
  expect(knownProviderFrom('CLAUDE')).toBe('claude');
  expect(knownProviderFrom('mistral')).toBeNull();
  expect(knownProviderFrom(null)).toBeNull();
  expect(knownProviderFrom(undefined)).toBeNull();
});

// --- inferProviderFromModel (family heuristic) ----------------------------

test('inferProviderFromModel maps model families', () => {
  expect(inferProviderFromModel('claude-opus-4-8')).toBe('claude');
  expect(inferProviderFromModel('sonnet-4.6')).toBe('claude');
  expect(inferProviderFromModel('gpt-4o')).toBe('codex');
  expect(inferProviderFromModel('o3-mini')).toBe('codex');
  expect(inferProviderFromModel('codex-latest')).toBe('codex');
  expect(inferProviderFromModel('gemini-2.5-pro')).toBe('gemini');
  expect(inferProviderFromModel('gemma-2')).toBe('gemini');
  expect(inferProviderFromModel('some-unknown-model')).toBeNull();
});

// --- resolveProviderForModel (ProviderId FIRST, model fallback) -----------

test('resolveProviderForModel prefers an explicitly-known provider over the model', () => {
  // Provider wins even when the model family disagrees.
  expect(resolveProviderForModel('gpt-4o', 'claude')).toBe('claude');
  expect(resolveProviderForModel('claude-opus-4-8', 'codex')).toBe('codex');
});

test('resolveProviderForModel falls back to the model family when provider is unknown', () => {
  expect(resolveProviderForModel('claude-opus-4-8')).toBe('claude');
  expect(resolveProviderForModel('gpt-4o', 'mistral')).toBe('codex');
  expect(resolveProviderForModel('gemini-2.5-pro', null)).toBe('gemini');
});

test('resolveProviderForModel returns null when nothing resolves', () => {
  expect(resolveProviderForModel(null)).toBeNull();
  expect(resolveProviderForModel('')).toBeNull();
  expect(resolveProviderForModel('some-unknown-model')).toBeNull();
});

// --- glyph resolution -----------------------------------------------------

test('providerGlyphFor returns the brand glyph, else the fallback', () => {
  expect(providerGlyphFor('claude')).toBe(PROVIDER_GLYPHS.claude);
  expect(providerGlyphFor('openai')).toBe(PROVIDER_GLYPHS.codex);
  // An unknown provider is not one of the three brand glyphs.
  const unknown = providerGlyphFor('mistral');
  expect(Object.values(PROVIDER_GLYPHS)).not.toContain(unknown);
});

test('getProviderIconForModel resolves a renderable glyph, contract-first', async () => {
  expect(getProviderIconForModel('claude-opus-4-8')).toBe(PROVIDER_GLYPHS.claude);
  expect(getProviderIconForModel('gpt-4o', 'claude')).toBe(PROVIDER_GLYPHS.claude);
  const Glyph = getProviderIconForModel('gemini-2.5-pro');
  const screen = render(<Glyph label="Gemini" />);
  await expect.element(screen.getByRole('img', { name: /gemini/i })).toBeInTheDocument();
});

// --- providerLabel --------------------------------------------------------

test('providerLabel gives brand names for known ids and title-cases the rest', () => {
  expect(providerLabel('claude')).toBe('Claude');
  expect(providerLabel('codex')).toBe('Codex');
  expect(providerLabel('gemini')).toBe('Gemini');
  expect(providerLabel('mistral')).toBe('Mistral');
  expect(providerLabel('some-new-provider')).toBe('Some new provider');
});
