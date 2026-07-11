import { composeStories } from '@storybook/react-vite';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import * as stories from './DegradedReviewChip.stories';

const { OneLens, ManyLenses, Healthy } = composeStories(stories);

test('names the single errored lens with singular copy', async () => {
  const screen = render(<OneLens />);
  await expect.element(screen.getByText(/degraded review/i)).toBeInTheDocument();
  expect(screen.container.textContent).toContain('1 lens failed');
  expect(screen.container.textContent).toContain('Security');
});

test('names every errored lens with plural copy', async () => {
  const screen = render(<ManyLenses />);
  expect(screen.container.textContent).toContain('3 lenses failed');
  for (const label of ['Security', 'Logic', 'Tests']) {
    expect(screen.container.textContent).toContain(label);
  }
});

test('renders nothing when no lens errored', () => {
  const screen = render(<Healthy />);
  expect(screen.container.textContent).toBe('');
});
