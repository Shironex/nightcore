import { composeStories } from '@storybook/react-vite';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { MotionProvider } from '../motion';
import * as stories from './Button.stories';

const { Primary, FiresOnClick, Busy } = composeStories(stories);

test('renders button label', async () => {
  const screen = render(
    <MotionProvider>
      <Primary />
    </MotionProvider>,
  );
  await expect.element(screen.getByRole('button', { name: 'Save' })).toBeVisible();
});

test('click invokes onClick', async () => {
  const onClick = vi.fn();
  const screen = render(
    <MotionProvider>
      <FiresOnClick onClick={onClick} />
    </MotionProvider>,
  );
  await screen.getByRole('button', { name: 'Save' }).click();
  expect(onClick).toHaveBeenCalled();
});

test('busy disables the button and marks it aria-busy', async () => {
  const screen = render(
    <MotionProvider>
      <Busy />
    </MotionProvider>,
  );
  const button = screen.getByRole('button', { name: 'Saving…' });
  await expect.element(button).toBeDisabled();
  await expect.element(button).toHaveAttribute('aria-busy', 'true');
});
