import { composeStories } from '@storybook/react-vite';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { previewSlug } from './CreateWorktreeDialog.hooks';
import * as stories from './CreateWorktreeDialog.stories';

const { Default, Busy, WithError } = composeStories(stories);

test('renders the create form with a name field and base picker', async () => {
  const screen = render(<Default />);
  await expect
    .element(screen.getByRole('heading', { name: 'Create new worktree' }))
    .toBeInTheDocument();
  await expect.element(screen.getByLabelText('Name')).toBeInTheDocument();
  await expect.element(screen.getByLabelText('Base branch')).toBeInTheDocument();
});

test('shows the derived term/<slug> preview as the name is typed', async () => {
  const screen = render(<Default />);
  await screen.getByLabelText('Name').fill('My Feature');
  await expect.element(screen.getByText('branch: term/my-feature')).toBeInTheDocument();
});

test('confirm is disabled until the name yields a non-empty slug', async () => {
  const screen = render(<Default />);
  const confirm = screen.getByRole('button', { name: 'Create worktree' });
  await expect.element(confirm).toBeDisabled();
  await screen.getByLabelText('Name').fill('shell');
  await expect.element(confirm).toBeEnabled();
});

test('confirming emits the collected request', async () => {
  const onConfirm = vi.fn();
  const screen = render(<Default onConfirm={onConfirm} />);
  await screen.getByLabelText('Name').fill('spike');
  await screen.getByRole('button', { name: 'Create worktree' }).click();
  expect(onConfirm).toHaveBeenCalledWith({ name: 'spike', createBranch: true, base: '' });
});

test('surfaces a create error inline without closing', async () => {
  const onClose = vi.fn();
  const screen = render(<WithError onClose={onClose} />);
  await expect
    .element(screen.getByText('a worktree named "spike" already exists'))
    .toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});

test('disables the form while a create is in flight', async () => {
  const screen = render(<Busy />);
  await expect.element(screen.getByLabelText('Name')).toBeDisabled();
});

test('previewSlug collapses to a folder-safe slug', () => {
  expect(previewSlug('My Feature Branch')).toBe('my-feature-branch');
  expect(previewSlug('  weird!!!name///here ')).toBe('weird-name-here');
  expect(previewSlug('!!!')).toBe('');
});
