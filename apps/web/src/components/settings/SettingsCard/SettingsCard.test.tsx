import { composeStories } from '@storybook/react-vite';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import * as stories from './SettingsCard.stories';

const { Models } = composeStories(stories);

test('renders the card title and its rows', async () => {
  const screen = render(<Models />);
  await expect.element(screen.getByText('Models', { exact: true })).toBeInTheDocument();
  await expect.element(screen.getByText('Default model', { exact: true })).toBeInTheDocument();
  await expect.element(screen.getByText('Reasoning effort', { exact: true })).toBeInTheDocument();
});
