import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { RunControls } from './RunControls';
import { useRunConfig } from './RunControls.hooks';

/** Drives `RunControls` with a live `useRunConfig` so the PR-number input, chips,
 *  and the Review gate are interactive in the story/test — the form state is owned
 *  here exactly as the PrReviewView hook owns it in the app. */
function ConfiguredRunControls({
  isStarting,
  onReview,
}: {
  isStarting: boolean;
  onReview: () => void;
}) {
  const config = useRunConfig(false);
  // Mirror the RunLifecycleShell's block `children` container (definite height,
  // NOT flex) so the two-pane's `h-full` resolves as it does in the app.
  return (
    <div style={{ height: 720 }}>
      <RunControls config={config} isStarting={isStarting} onReview={onReview} />
    </div>
  );
}

const meta = {
  title: 'PrReview/RunControls',
  component: ConfiguredRunControls,
  parameters: { layout: 'fullscreen' },
  args: {
    isStarting: false,
    onReview: fn(),
  },
} satisfies Meta<typeof ConfiguredRunControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};

export const Starting: Story = {
  args: { isStarting: true },
};
