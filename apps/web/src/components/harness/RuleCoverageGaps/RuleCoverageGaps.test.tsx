import { composeStories } from '@storybook/react-vite';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import * as stories from './RuleCoverageGaps.stories';

const { MixedCoverage, AllEnforced, DriftNotMeasured, DriftErrored, Empty } =
  composeStories(stories);

test('renders a row per convention with its coverage status badge', async () => {
  const screen = render(<MixedCoverage />);
  // Exact match: the badges ('Enforced'/'Documented only'/'Unenforced') are the
  // capitalized siblings of the lowercase header tally labels, and 'Enforced' is a
  // substring of 'Unenforced'.
  await expect
    .element(screen.getByText('Enforced', { exact: true }))
    .toBeInTheDocument();
  await expect
    .element(screen.getByText('Documented only', { exact: true }))
    .toBeInTheDocument();
  await expect
    .element(screen.getByText('Unenforced', { exact: true }))
    .toBeInTheDocument();
  // Each convention title renders.
  await expect
    .element(screen.getByText('Components follow strict folder-per-component'))
    .toBeInTheDocument();
  await expect
    .element(screen.getByText('No reaching past a feature public barrel'))
    .toBeInTheDocument();
});

test('anchors the copy on coverage vs conformance', async () => {
  const screen = render(<MixedCoverage />);
  await expect
    .element(screen.getByText(/is followed.*at every site/i))
    .toBeInTheDocument();
});

test('shows the detail line for each coverage status (enforced by / documented / propose)', async () => {
  const screen = render(<MixedCoverage />);
  await expect
    .element(screen.getByText(/enforced by nightcore\/component-folder-structure/i))
    .toBeInTheDocument();
  await expect
    .element(screen.getByText(/documented: Errors go through the taxonomy\./i))
    .toBeInTheDocument();
  await expect
    .element(screen.getByText(/propose a eslint-rule to enforce it/i))
    .toBeInTheDocument();
});

test('surfaces the distinct enforcing-rule count in the header caption', async () => {
  const screen = render(<AllEnforced />);
  await expect
    .element(screen.getByText(/1 enforcing rule found/i))
    .toBeInTheDocument();
});

test('a drifted chip ALWAYS shows its method + X/Y site counts', async () => {
  const screen = render(<MixedCoverage />);
  await expect.element(screen.getByText('Drifted', { exact: true })).toBeInTheDocument();
  await expect
    .element(screen.getByText(/lint-meta: folder-per-component · 3\/42 sites/))
    .toBeInTheDocument();
});

test('a clean chip ALWAYS shows its method + X/Y site counts (never a bare "clean")', async () => {
  const screen = render(<MixedCoverage />);
  await expect.element(screen.getByText('Clean', { exact: true })).toBeInTheDocument();
  await expect
    .element(screen.getByText(/shell: rg -c cross-feature-import · 0\/18 sites/))
    .toBeInTheDocument();
});

test('derives `uncheckable` for a covered convention with no armed check', async () => {
  const screen = render(<MixedCoverage />);
  await expect
    .element(screen.getByText('Uncheckable', { exact: true }))
    .toBeInTheDocument();
  await expect
    .element(screen.getByText(/no armed check measures this convention/i))
    .toBeInTheDocument();
});

test('shows the drift tally row once an EnforceRun has measured drift', async () => {
  const screen = render(<MixedCoverage />);
  // The uppercase "Drift" section header renders only when driftMeasured.
  await expect.element(screen.getByText('Drift', { exact: true })).toBeInTheDocument();
});

test('an errored check shows its reason via the method — never silently "clean"', async () => {
  const screen = render(<DriftErrored />);
  await expect.element(screen.getByText('Errored', { exact: true })).toBeInTheDocument();
  await expect
    .element(
      screen.getByText(/api-extractor exited 2 \(config not found\) · via shell: api-extractor run/i),
    )
    .toBeInTheDocument();
  // Fail-visible: no "Clean" chip anywhere in an errored render.
  expect(screen.container.textContent).not.toContain('Clean');
});

test('reads "not measured yet" before any EnforceRun, with no drift chips', async () => {
  const screen = render(<DriftNotMeasured />);
  await expect
    .element(screen.getByText(/Conformance not measured yet/i))
    .toBeInTheDocument();
  // No drift chips render (unmeasured cells): none of the drift labels appear.
  const text = screen.container.textContent ?? '';
  expect(text).not.toContain('Uncheckable');
  expect(text).not.toContain('Drifted');
  expect(text).not.toContain('Clean');
});

test('renders nothing when the run carries no coverage', async () => {
  const screen = render(<Empty />);
  expect(screen.container.querySelector('[aria-label="Rule coverage"]')).toBeNull();
});
