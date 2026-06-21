import { composeStories } from '@storybook/react-vite';
import { render } from 'vitest-browser-react';
import { expect, test, vi } from 'vitest';
import * as stories from './TaskCard.stories';

const { Failed, Done, Blocked, Running } = composeStories(stories);

test('shows the error line on a failed task', async () => {
  const screen = render(<Failed />);
  await expect
    .element(screen.getByText("cannot resolve 'sass-loader'"))
    .toBeInTheDocument();
});

test('calls onSelect with the task id when the card body is clicked', async () => {
  const onSelect = vi.fn();
  const screen = render(<Done onSelect={onSelect} />);
  await screen.getByRole('button', { name: /wire up auth guard/i }).click();
  expect(onSelect).toHaveBeenCalledWith('t-done');
});

test('resolves the model id to its display name', async () => {
  const screen = render(<Running />);
  await expect.element(screen.getByText('Sonnet 4.8')).toBeInTheDocument();
});

test('disables the run action and shows a Blocked label when blocked', async () => {
  const screen = render(<Blocked />);
  const blockedBtn = screen.getByRole('button', { name: /^blocked$/i });
  await expect.element(blockedBtn).toBeDisabled();
});

test('calls onCancel from the running card', async () => {
  const onCancel = vi.fn();
  const screen = render(<Running onCancel={onCancel} />);
  await screen.getByRole('button', { name: /cancel run/i }).click();
  expect(onCancel).toHaveBeenCalledWith('t-running');
});
