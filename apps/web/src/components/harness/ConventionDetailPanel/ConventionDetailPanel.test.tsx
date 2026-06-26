import { composeStories } from '@storybook/react-vite';
import { render } from 'vitest-browser-react';
import { expect, test, vi } from 'vitest';
import * as stories from './ConventionDetailPanel.stories';

const { Open, Dismissed } = composeStories(stories);

test('renders the convention title and grounded evidence', async () => {
  const screen = render(<Open />);
  await expect
    .element(screen.getByText('Folder-per-component with a colocated sibling set'))
    .toBeInTheDocument();
  await expect
    .element(screen.getByText('apps/web/src/components/board/TaskCard/TaskCard.tsx:1-40 · TaskCard'))
    .toBeInTheDocument();
});

test('dismisses the convention via the action button', async () => {
  const onDismiss = vi.fn();
  const screen = render(<Open onDismiss={onDismiss} />);
  await screen.getByRole('button', { name: /dismiss/i }).click();
  expect(onDismiss).toHaveBeenCalledWith('c1');
});

test('a dismissed convention offers a restore action', async () => {
  const onRestore = vi.fn();
  const screen = render(<Dismissed onRestore={onRestore} />);
  await screen.getByRole('button', { name: /restore/i }).click();
  expect(onRestore).toHaveBeenCalledWith('c1');
});
