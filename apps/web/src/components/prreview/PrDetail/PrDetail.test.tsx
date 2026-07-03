import { composeStories } from '@storybook/react-vite';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import * as stories from './PrDetail.stories';

const { Selected, NothingSelected, TypedNumberNotInList } = composeStories(stories);

test('renders the selected PR title, labels, and description', async () => {
  const screen = render(<Selected />);
  await expect
    .element(screen.getByRole('heading', { name: /youtube cookie auth/i }))
    .toBeInTheDocument();
  await expect.element(screen.getByText('enhancement')).toBeInTheDocument();
  await expect.element(screen.getByText(/^background$/i)).toBeInTheDocument();
});

test('the open-on-GitHub button reports the PR url', async () => {
  const onOpenExternal = vi.fn();
  const screen = render(<Selected onOpenExternal={onOpenExternal} />);
  await screen.getByRole('button', { name: /open on github/i }).click();
  expect(onOpenExternal).toHaveBeenCalledWith(
    'https://github.com/Shironex/shiranami/pull/40',
  );
});

test('toggling a lens updates the review hint', async () => {
  const screen = render(<Selected />);
  await expect
    .element(screen.getByText(/across 5 lenses/i))
    .toBeInTheDocument();
  await screen.getByRole('button', { name: /^security$/i }).click();
  await expect
    .element(screen.getByText(/across 4 lenses/i))
    .toBeInTheDocument();
});

test('shows the empty prompt when nothing is selected', async () => {
  const screen = render(<NothingSelected />);
  await expect
    .element(screen.getByText(/select a pull request to review/i))
    .toBeInTheDocument();
});

test('a typed number not in the list still offers the review action', async () => {
  const screen = render(<TypedNumberNotInList />);
  await expect
    .element(screen.getByText(/isn.t in the open list/i))
    .toBeInTheDocument();
  await expect
    .element(screen.getByRole('button', { name: /review pr #999/i }))
    .toBeInTheDocument();
});
