import { composeStories } from '@storybook/react-vite';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import * as stories from './Board.stories';

const { Empty, Populated, AutoModeOn, CircuitBreakerPaused } =
  composeStories(stories);

test('renders all five board columns, including the Done label', async () => {
  const screen = render(<Empty />);
  await expect
    .element(screen.getByRole('heading', { name: 'Backlog', level: 2 }))
    .toBeInTheDocument();
  await expect
    .element(screen.getByRole('heading', { name: 'In Progress', level: 2 }))
    .toBeInTheDocument();
  await expect
    .element(screen.getByRole('heading', { name: 'Waiting Approval', level: 2 }))
    .toBeInTheDocument();
  await expect
    .element(screen.getByRole('heading', { name: 'Done', level: 2 }))
    .toBeInTheDocument();
  await expect
    .element(screen.getByRole('heading', { name: 'Failed', level: 2 }))
    .toBeInTheDocument();
});

test('renders the project path and branch in the header subtitle', async () => {
  const screen = render(<Populated />);
  await expect.element(screen.getByText('~/dev/nightcore')).toBeInTheDocument();
  // The header subtitle pairs the project branch with the kanban title; assert it
  // there (main-mode cards also carry a "main" chip, so a bare text query is
  // ambiguous on a populated board).
  const heading = screen.getByRole('heading', { name: /kanban board/i });
  await expect.element(heading).toBeInTheDocument();
});

test('reflects the live loop state on the Auto Mode toggle', async () => {
  const screen = render(<AutoModeOn />);
  await expect
    .element(screen.getByRole('button', { name: 'Auto Mode', exact: true }))
    .toHaveAttribute('aria-pressed', 'true');
});

test('surfaces the circuit-breaker Resume banner when the loop has paused', async () => {
  const screen = render(<CircuitBreakerPaused />);
  await expect
    .element(screen.getByText(/paused after 3 consecutive failures/i))
    .toBeInTheDocument();
  await expect
    .element(screen.getByRole('button', { name: /resume/i }))
    .toBeInTheDocument();
});
