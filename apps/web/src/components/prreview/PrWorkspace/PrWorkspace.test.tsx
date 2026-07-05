import { composeStories } from '@storybook/react-vite';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import * as stories from './PrWorkspace.stories';

const { Selected, TypedNumberNotInList } = composeStories(stories);

test('renders the PR header: title, author, labels, and the status block', async () => {
  const screen = render(<Selected />);
  await expect
    .element(screen.getByRole('heading', { name: /youtube cookie auth/i }))
    .toBeInTheDocument();
  await expect.element(screen.getByText('@Shironex')).toBeInTheDocument();
  await expect.element(screen.getByText('enhancement')).toBeInTheDocument();
  // The status block renders from the override snapshot.
  await expect.element(screen.getByText('Clean against base')).toBeInTheDocument();
  await expect.element(screen.getByText(/base: main/)).toBeInTheDocument();
});

test('the open-on-GitHub button reports the PR url', async () => {
  const onOpenExternal = vi.fn();
  const screen = render(<Selected onOpenExternal={onOpenExternal} />);
  await screen.getByRole('button', { name: /open on github/i }).click();
  expect(onOpenExternal).toHaveBeenCalledWith(
    'https://github.com/Shironex/shiranami/pull/40',
  );
});

test('frames the description as untrusted, sanitized content', async () => {
  const screen = render(<Selected />);
  await expect
    .element(screen.getByText(/untrusted contributor content · sanitized/i))
    .toBeInTheDocument();
  await expect.element(screen.getByText(/^background$/i)).toBeInTheDocument();
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
