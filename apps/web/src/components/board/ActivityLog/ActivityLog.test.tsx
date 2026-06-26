import { composeStories } from '@storybook/react-vite';
import { render } from 'vitest-browser-react';
import { expect, test } from 'vitest';
import * as stories from './ActivityLog.stories';

const { Empty, WaitingForToken, SingleSession, MultiSession, WithError } =
  composeStories(stories);

test('renders the run-this-task prompt when there is no activity', async () => {
  const screen = render(<Empty />);
  await expect
    .element(screen.getByRole('heading', { name: 'Activity' }))
    .toBeInTheDocument();
  await expect
    .element(screen.getByText(/run this task to stream its transcript/i))
    .toBeInTheDocument();
});

test('shows the live heading and the waiting prompt while running', async () => {
  const screen = render(<WaitingForToken />);
  await expect
    .element(screen.getByRole('heading', { name: 'Live activity' }))
    .toBeInTheDocument();
  await expect.element(screen.getByText(/Waiting for first token/i)).toBeInTheDocument();
});

test('renders a single session inline without collapsible chrome', async () => {
  const screen = render(<SingleSession />);
  await expect
    .element(screen.getByText(/Adding the auth middleware/i))
    .toBeInTheDocument();
  // The inline single-session view has no per-session toggle button.
  expect(screen.container.querySelector('button[aria-expanded]')).toBeNull();
});

test('renders multiple sessions as collapsible blocks with the latest open', async () => {
  const screen = render(<MultiSession />);
  const toggles = screen.container.querySelectorAll('button[aria-expanded]');
  expect(toggles.length).toBe(2);
  // The latest (verification) session opens by default.
  await expect
    .element(screen.getByText(/Reviewing the diff against the base branch/i))
    .toBeInTheDocument();
});

test('renders a terminal session error in place of the timeline', async () => {
  const screen = render(<WithError />);
  await expect
    .element(screen.getByText("cannot resolve 'sass-loader'"))
    .toBeInTheDocument();
});
