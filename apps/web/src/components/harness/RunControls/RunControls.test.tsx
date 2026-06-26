import { composeStories } from '@storybook/react-vite';
import { render } from 'vitest-browser-react';
import { expect, test, vi } from 'vitest';
import * as stories from './RunControls.stories';

const { Idle, Running } = composeStories(stories);

test('fires onScan with every lens selected by default', async () => {
  const onScan = vi.fn();
  const screen = render(<Idle onScan={onScan} />);
  await screen.getByRole('button', { name: /^scan$/i }).click();
  const call = onScan.mock.calls[0];
  // All eight convention lenses selected by default.
  expect(call?.[0]).toHaveLength(8);
});

test('clearing the selection disables Scan', async () => {
  const onScan = vi.fn();
  const screen = render(<Idle onScan={onScan} />);
  await screen.getByRole('button', { name: /^none$/i }).click();
  await expect.element(screen.getByRole('button', { name: /^scan$/i })).toBeDisabled();
});

test('a running stream swaps Scan for a cancel action', async () => {
  const onCancel = vi.fn();
  const screen = render(<Running onCancel={onCancel} />);
  await screen.getByRole('button', { name: /cancel scan/i }).click();
  expect(onCancel).toHaveBeenCalledTimes(1);
});
