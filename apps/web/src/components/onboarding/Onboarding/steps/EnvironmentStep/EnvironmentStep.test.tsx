import { composeStories } from '@storybook/react-vite';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import * as stories from './EnvironmentStep.stories';

const { ClaudeAuthMissing, CodexAuthMissing, Ready } = composeStories(stories);

test('renders the staged environment success state', async () => {
  const screen = render(<Ready />);
  await expect.element(screen.getByText('Environment check')).toBeInTheDocument();
  await expect.element(screen.getByText('Claude Code CLI')).toBeInTheDocument();
  await expect.element(screen.getByText('Codex CLI')).toBeInTheDocument();
  await expect.element(screen.getByText('Local environment is ready.')).toBeInTheDocument();
});

test('renders the auth remediation row when Claude auth is missing', async () => {
  const screen = render(<ClaudeAuthMissing />);
  await expect.element(screen.getByText('Claude authenticated')).toBeInTheDocument();
  await expect.element(screen.getByText('A required check failed. Fix it, then re-check.')).toBeInTheDocument();
  await expect.element(screen.getByRole('button', { name: /re-check/i })).toBeInTheDocument();
});

test('renders the auth remediation row when Codex auth is missing', async () => {
  const screen = render(<CodexAuthMissing />);
  await expect.element(screen.getByText('Codex authenticated')).toBeInTheDocument();
  await expect.element(screen.getByText('codex login')).toBeInTheDocument();
});
