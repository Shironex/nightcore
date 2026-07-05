import { composeStories } from '@storybook/react-vite';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import * as stories from './ConvertToTaskDialog.stories';

const { Build, ComplexFeature, AlreadyLinked, ErrorState } = composeStories(stories);

test('previews the task title, kind, and complexity→effort sizing', async () => {
  const screen = render(<Build />);
  await expect
    .element(screen.getByText('#128 · Crash when opening a project with no git remote'))
    .toBeInTheDocument();
  await expect.element(screen.getByText('Moderate → Medium effort')).toBeInTheDocument();
  await expect.element(screen.getByRole('button', { name: /create task/i })).toBeInTheDocument();
});

test('flags a complex feature as a Decompose task', async () => {
  const screen = render(<ComplexFeature />);
  await expect.element(screen.getByText(/lands as a Decompose task/i)).toBeInTheDocument();
});

test('offers "Go to task" for an already-linked validation instead of converting', async () => {
  const screen = render(<AlreadyLinked />);
  await expect
    .element(screen.getByText(/already linked to a board task/i))
    .toBeInTheDocument();
  await expect.element(screen.getByRole('button', { name: /go to task/i })).toBeInTheDocument();
});

test('surfaces a convert error', async () => {
  const screen = render(<ErrorState />);
  await expect
    .element(screen.getByText(/could not create the task/i))
    .toBeInTheDocument();
});
