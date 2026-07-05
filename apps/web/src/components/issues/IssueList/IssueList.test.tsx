import { composeStories } from '@storybook/react-vite';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import * as stories from './IssueList.stories';

const { Default, Loading, ErrorState, Empty, NoMatches } = composeStories(stories);

test('renders each issue with its number, title, and validation badge', async () => {
  const screen = render(<Default />);
  await expect
    .element(screen.getByText('Crash when opening a project with no git remote'))
    .toBeInTheDocument();
  await expect.element(screen.getByText('#128')).toBeInTheDocument();
  await expect.element(screen.getByText('Validated')).toBeInTheDocument();
  await expect.element(screen.getByText('Stale')).toBeInTheDocument();
});

test('exposes a filter input', async () => {
  const screen = render(<Default />);
  await expect
    .element(screen.getByRole('searchbox', { name: /filter issues/i }))
    .toBeInTheDocument();
});

test('shows loading skeletons while fetching', async () => {
  const screen = render(<Loading />);
  await expect
    .element(screen.getByText('Crash when opening a project with no git remote'))
    .not.toBeInTheDocument();
});

test('surfaces a gh error with a retry affordance', async () => {
  const screen = render(<ErrorState />);
  await expect.element(screen.getByText("Couldn't load issues")).toBeInTheDocument();
  await expect.element(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
});

test('distinguishes "no issues" from "no matches"', async () => {
  const empty = render(<Empty />);
  await expect.element(empty.getByText('No open issues')).toBeInTheDocument();

  const noMatch = render(<NoMatches />);
  await expect.element(noMatch.getByText('No matching issues')).toBeInTheDocument();
});
