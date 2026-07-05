import { composeStories } from '@storybook/react-vite';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import * as stories from './ResultsPanel.stories';

const { Valid, Stale, NeedsClarification, Posted, Converted } = composeStories(stories);

test('renders the verdict card, reasoning, related files, plan, and PR analysis', async () => {
  const screen = render(<Valid />);
  await expect.element(screen.getByText('Valid')).toBeInTheDocument();
  await expect.element(screen.getByText('Bug report')).toBeInTheDocument();
  await expect.element(screen.getByText('High confidence')).toBeInTheDocument();
  await expect.element(screen.getByText('Bug reproduced in the code')).toBeInTheDocument();
  await expect.element(screen.getByText('src/git/remote.ts')).toBeInTheDocument();
  await expect.element(screen.getByText('PR needs work')).toBeInTheDocument();
  await expect
    .element(screen.getByRole('button', { name: /post as comment/i }))
    .toBeInTheDocument();
});

test('badges a stale verdict', async () => {
  const screen = render(<Stale />);
  await expect.element(screen.getByText('Stale')).toBeInTheDocument();
});

test('lists missing information for a needs-clarification verdict', async () => {
  const screen = render(<NeedsClarification />);
  await expect.element(screen.getByText('Needs clarification')).toBeInTheDocument();
  await expect.element(screen.getByText('exact reproduction steps')).toBeInTheDocument();
});

test('shows the posted link once the comment is posted', async () => {
  const screen = render(<Posted />);
  await expect.element(screen.getByText('Comment posted')).toBeInTheDocument();
});

test('offers "Go to task" once converted', async () => {
  const screen = render(<Converted />);
  await expect.element(screen.getByRole('button', { name: /go to task/i })).toBeInTheDocument();
});
