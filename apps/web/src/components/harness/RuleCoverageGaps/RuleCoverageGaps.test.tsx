import { composeStories } from '@storybook/react-vite';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import * as stories from './RuleCoverageGaps.stories';

const { MixedCoverage, AllEnforced, Empty } = composeStories(stories);

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

test('anchors the copy on "coverage, not conformance"', async () => {
  const screen = render(<MixedCoverage />);
  await expect
    .element(screen.getByText(/coverage, not conformance/i))
    .toBeInTheDocument();
});

test('shows the detail line for each status (enforced by / documented / propose)', async () => {
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

test('renders nothing when the run carries no coverage', async () => {
  const screen = render(<Empty />);
  expect(screen.container.querySelector('[aria-label="Rule coverage"]')).toBeNull();
});
