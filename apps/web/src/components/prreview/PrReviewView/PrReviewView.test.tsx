import { composeStories } from '@storybook/react-vite';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import * as stories from './PrReviewView.stories';

const { Idle, NoProject } = composeStories(stories);

test('renders the PR Review header for an active project', async () => {
  const screen = render(<Idle />);
  await expect
    .element(screen.getByRole('heading', { name: 'PR Review' }))
    .toBeInTheDocument();
  await expect.element(screen.getByText('acme')).toBeInTheDocument();
});

test('shows the CONFIGURE master-detail (PR list + empty detail) when idle', async () => {
  const screen = render(<Idle />);
  await expect
    .element(screen.getByText('Pull requests', { exact: true }))
    .toBeInTheDocument();
  await expect
    .element(screen.getByText(/select a pull request to review/i))
    .toBeInTheDocument();
});

test('shows the empty state when no project is active', async () => {
  const screen = render(<NoProject />);
  await expect.element(screen.getByText('No active project')).toBeInTheDocument();
});
