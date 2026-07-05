import { composeStories } from '@storybook/react-vite';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import * as stories from './PostCommentDialog.stories';

const { Default, ErrorState } = composeStories(stories);

test('shows the exact comment markdown that will be posted', async () => {
  const screen = render(<Default />);
  await expect
    .element(screen.getByRole('heading', { name: /post verdict as a github comment/i }))
    .toBeInTheDocument();
  await expect.element(screen.getByText('Nightcore validation')).toBeInTheDocument();
});

test('keeps the Post button disabled until the preview is confirmed', async () => {
  const screen = render(<Default />);
  const post = screen.getByRole('button', { name: /post comment/i });
  await expect.element(post).toBeDisabled();
  // Confirm the preview by clicking the (visible) checkbox label — the native input
  // itself is sr-only, so the label is the clickable affordance — enabling Post.
  await screen.getByText(/reviewed the comment/i).click();
  await expect.element(post).not.toBeDisabled();
});

test('does not allow confirming when the preview failed to build', async () => {
  const screen = render(<ErrorState />);
  await expect
    .element(screen.getByText('Could not build the comment (no verdict).'))
    .toBeInTheDocument();
  await expect.element(screen.getByRole('checkbox', { name: /reviewed the comment/i })).toBeDisabled();
  await expect.element(screen.getByRole('button', { name: /post comment/i })).toBeDisabled();
});
