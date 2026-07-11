import { composeStories } from '@storybook/react-vite';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import * as stories from './FixDiffPreview.stories';

const { Populated, Empty, LoadFailed } = composeStories(stories);

test('lists the fix commit changed files with the git summary', async () => {
  const screen = render(<Populated />);
  await expect.element(screen.getByText('src/auth.ts')).toBeInTheDocument();
  await expect.element(screen.getByText('src/new.ts')).toBeInTheDocument();
  await expect.element(screen.getByText('2 files changed, +16 -2')).toBeInTheDocument();
});

test('expanding a file row reveals its unified-diff patch', async () => {
  const screen = render(<Populated />);
  const row = screen.getByRole('button', { name: /src\/auth\.ts/ });
  await expect.element(row).toBeInTheDocument();
  await row.click();
  // The patch's changed line renders once the lazy fetch resolves.
  await expect.element(screen.getByText(/\[redacted\]/)).toBeInTheDocument();
});

test('renders a quiet note when the fix commit changed nothing', async () => {
  const screen = render(<Empty />);
  await expect
    .element(screen.getByText(/no file changes to preview/i))
    .toBeInTheDocument();
});

test('degrades to a quiet note when the diff fetch fails', async () => {
  const screen = render(<LoadFailed />);
  await expect
    .element(screen.getByText(/could not load the fix diff/i))
    .toBeInTheDocument();
});
