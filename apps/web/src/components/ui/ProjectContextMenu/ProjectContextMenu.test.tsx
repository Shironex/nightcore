import { composeStories } from '@storybook/react-vite';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { ProjectContextMenu } from './ProjectContextMenu';
import * as stories from './ProjectContextMenu.stories';

const { Default } = composeStories(stories);

test('renders child content', async () => {
  const screen = render(<Default />);
  await expect.element(screen.getByText('Right-click me')).toBeInTheDocument();
});

test('shows remove action when provided and invokes it from the context menu', async () => {
  const onRemove = vi.fn();
  const screen = render(
    <ProjectContextMenu onEdit={vi.fn()} onRemove={onRemove}>
      <button type="button">Project row</button>
    </ProjectContextMenu>,
  );

  screen.getByText('Project row').element().dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 12,
      clientY: 16,
    }),
  );

  await screen.getByRole('menuitem', { name: 'Remove from Nightcore' }).click();
  expect(onRemove).toHaveBeenCalledOnce();
});
