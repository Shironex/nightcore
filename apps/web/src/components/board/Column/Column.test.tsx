import { composeStories } from '@storybook/react-vite';
import { render } from 'vitest-browser-react';
import { expect, test, vi } from 'vitest';
import * as stories from './Column.stories';

const { Empty, InProgress, WaitingApproval, Verified } = composeStories(stories);

test('shows the custom empty placeholder when a column has no tasks', async () => {
  const screen = render(<Empty />);
  await expect.element(screen.getByText('Add a task to begin')).toBeInTheDocument();
});

test('renders the task title for a populated column', async () => {
  const screen = render(<InProgress />);
  await expect.element(screen.getByText('Generate API client')).toBeInTheDocument();
});

test('renders the roadmap badge beside the column title', async () => {
  const screen = render(<WaitingApproval />);
  await expect.element(screen.getByText('M3')).toBeInTheDocument();
});

test('fires onClear from a clearable, non-empty column', async () => {
  const onClear = vi.fn();
  const screen = render(<Verified onClear={onClear} />);
  await screen.getByRole('button', { name: /clear/i }).click();
  expect(onClear).toHaveBeenCalled();
});
