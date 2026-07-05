import { composeStories } from '@storybook/react-vite';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import * as stories from './IssueTriageView.stories';

const { Idle, NoProject } = composeStories(stories);

test('renders the Issue Triage header for an active project', async () => {
  const screen = render(<Idle />);
  await expect
    .element(screen.getByRole('heading', { name: 'Issue Triage' }))
    .toBeInTheDocument();
  await expect.element(screen.getByText('· acme')).toBeInTheDocument();
});

test('offers a filter input for the issue list', async () => {
  const screen = render(<Idle />);
  await expect
    .element(screen.getByRole('searchbox', { name: /filter issues/i }))
    .toBeInTheDocument();
});

test('shows the empty state when no project is active', async () => {
  const screen = render(<NoProject />);
  await expect.element(screen.getByText('No active project')).toBeInTheDocument();
});
