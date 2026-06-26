import { composeStories } from '@storybook/react-vite';
import { render } from 'vitest-browser-react';
import { expect, test } from 'vitest';
import * as stories from './HarnessView.stories';

const { Idle, NoProject } = composeStories(stories);

test('renders the Harness header for an active project', async () => {
  const screen = render(<Idle />);
  await expect.element(screen.getByRole('heading', { name: 'Harness' })).toBeInTheDocument();
  await expect.element(screen.getByText('acme')).toBeInTheDocument();
});

test('offers the Scan control in the idle project view', async () => {
  const screen = render(<Idle />);
  await expect.element(screen.getByRole('button', { name: /^scan$/i })).toBeInTheDocument();
});

test('toggles between the conventions and proposed-harness sections', async () => {
  const screen = render(<Idle />);
  await screen.getByRole('tab', { name: /proposed harness/i }).click();
  await expect
    .element(screen.getByText(/run a scan to synthesize a proposed harness/i))
    .toBeInTheDocument();
});

test('shows the empty state when no project is active', async () => {
  const screen = render(<NoProject />);
  await expect.element(screen.getByText('No active project')).toBeInTheDocument();
});
