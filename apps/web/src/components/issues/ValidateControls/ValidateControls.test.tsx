import { composeStories } from '@storybook/react-vite';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import * as stories from './ValidateControls.stories';

const { Idle, HasVerdict, Running, StartError } = composeStories(stories);

test('shows the Validate button and the model picker when idle', async () => {
  const screen = render(<Idle />);
  await expect
    .element(screen.getByRole('button', { name: /validate against the codebase/i }))
    .toBeInTheDocument();
  // The live-wired ModelSelectField resolves its catalog (mocked outside Tauri) and
  // renders the model combobox.
  await expect.element(screen.getByRole('combobox', { name: /model/i })).toBeInTheDocument();
});

test('relabels the button "Re-validate" once a verdict exists', async () => {
  const screen = render(<HasVerdict />);
  await expect
    .element(screen.getByRole('button', { name: /^re-validate$/i }))
    .toBeInTheDocument();
});

test('shows the running panel + live progress note + cancel while validating', async () => {
  const screen = render(<Running />);
  await expect.element(screen.getByText('Investigating related files…')).toBeInTheDocument();
  await expect
    .element(screen.getByRole('button', { name: /cancel validation/i }))
    .toBeInTheDocument();
});

test('surfaces a start error', async () => {
  const screen = render(<StartError />);
  await expect
    .element(screen.getByText(/already running — cancel it first/i))
    .toBeInTheDocument();
});
