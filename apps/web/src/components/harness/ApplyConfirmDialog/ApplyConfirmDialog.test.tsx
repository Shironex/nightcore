import { composeStories } from '@storybook/react-vite';
import { render } from 'vitest-browser-react';
import { userEvent } from '@vitest/browser/context';
import { expect, test, vi } from 'vitest';
import * as stories from './ApplyConfirmDialog.stories';

const { Default, Applying, WithError } = composeStories(stories);

test('states the target path and write mode, and confirms via the Apply button', async () => {
  const onConfirm = vi.fn();
  const screen = render(<Default onConfirm={onConfirm} />);
  await expect
    .element(
      screen.getByText('packages/eslint-plugin/src/rules/component-folder-structure.ts'),
    )
    .toBeInTheDocument();
  await screen.getByRole('button', { name: /^apply$/i }).click();
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

test('cancels via Esc', async () => {
  const onCancel = vi.fn();
  render(<Default onCancel={onCancel} />);
  // Esc routes through the shared Modal's keydown handler.
  await userEvent.keyboard('{Escape}');
  expect(onCancel).toHaveBeenCalled();
});

test('disables both actions while the write is in flight', async () => {
  const screen = render(<Applying />);
  await expect.element(screen.getByRole('button', { name: /applying/i })).toBeDisabled();
  await expect.element(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
});

test('surfaces the apply error inline', async () => {
  const screen = render(<WithError />);
  await expect
    .element(screen.getByText(/file already exists — refusing to overwrite/i))
    .toBeInTheDocument();
});
