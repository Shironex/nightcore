import { composeStories } from '@storybook/react-vite';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import * as stories from './RunControls.stories';

const { Idle } = composeStories(stories);

// The stories render outside Tauri, so the open-PR list is empty — a PR is chosen
// through the left pane's typed-number escape hatch ("Select PR #N"), the same
// onChange path a click on a listed PR card takes. (The detail pane's own
// interactions — lens toggles, the Review action — are covered by PrDetail.test,
// which renders that pane in a content-height context.)

test('no PR chosen shows the empty detail prompt', async () => {
  const screen = render(<Idle />);
  await expect
    .element(screen.getByText(/select a pull request to review/i))
    .toBeInTheDocument();
});

test('choosing a PR from the list drives the detail pane and enables Review', async () => {
  const screen = render(<Idle />);
  await screen
    .getByRole('textbox', { name: /filter open pull requests/i })
    .fill('128');
  await screen.getByRole('button', { name: /select pr #128/i }).click();
  // Left selection flows into the right detail pane: an enabled review action for
  // the chosen PR (default lenses all selected).
  await expect
    .element(screen.getByRole('button', { name: /^review pr #128$/i }))
    .toBeEnabled();
});
