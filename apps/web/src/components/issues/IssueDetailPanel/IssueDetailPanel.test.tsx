import { composeStories } from '@storybook/react-vite';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import * as stories from './IssueDetailPanel.stories';

const { Default, NoSelection, ErrorState, NoDescription } = composeStories(stories);

test('renders the issue header + body + comments as sanitized markdown', async () => {
  const screen = render(<Default />);
  await expect
    .element(screen.getByRole('heading', { name: /crash when opening a project/i }))
    .toBeInTheDocument();
  await expect.element(screen.getByText('Steps to reproduce')).toBeInTheDocument();
  await expect.element(screen.getByText('maintainer')).toBeInTheDocument();
  // The untrusted-content framing is present on the description + comments.
  await expect
    .element(screen.getByText('untrusted GitHub content · sanitized').first())
    .toBeInTheDocument();
});

test('prompts to select an issue when none is selected', async () => {
  const screen = render(<NoSelection />);
  await expect.element(screen.getByText('Select an issue')).toBeInTheDocument();
});

test('surfaces a detail-fetch error', async () => {
  const screen = render(<ErrorState />);
  await expect
    .element(screen.getByText('Could not read the issue (gh failed).'))
    .toBeInTheDocument();
});

test('falls back to a "no description" line for an empty body', async () => {
  const screen = render(<NoDescription />);
  await expect.element(screen.getByText('No description provided.')).toBeInTheDocument();
});
