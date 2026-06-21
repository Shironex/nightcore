import { composeStories } from '@storybook/react-vite';
import { render } from 'vitest-browser-react';
import { expect, test } from 'vitest';
import * as stories from './AppShell.stories';

const { Default } = composeStories(stories);

test('renders the sidebar nav and the active project from mock data', async () => {
  const screen = render(<Default />);
  // Sidebar nav items.
  await expect.element(screen.getByText('Kanban Board')).toBeInTheDocument();
  await expect.element(screen.getByText('Settings')).toBeInTheDocument();
  // The mock active project surfaces in the switcher.
  await expect.element(screen.getByText('nightcore').first()).toBeInTheDocument();
});

test('routes to the Projects surface when its nav item is clicked', async () => {
  const screen = render(<Default />);
  await screen.getByText('Projects').click();
  await expect
    .element(
      screen.getByText('Each project is a git repo with its own board & settings.'),
    )
    .toBeInTheDocument();
});

test('routes to the Settings surface and shows the run-shaping controls', async () => {
  const screen = render(<Default />);
  await screen.getByRole('button', { name: /^Settings S$/ }).click();
  // The Models & runs page header and its live default-model control.
  await expect
    .element(screen.getByRole('heading', { name: 'Models & runs', level: 1 }))
    .toBeInTheDocument();
  await expect
    .element(screen.getByRole('button', { name: 'Opus' }))
    .toBeInTheDocument();
});
