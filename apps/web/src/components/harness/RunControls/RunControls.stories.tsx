import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { RunControls } from './RunControls';
import { useRunConfig } from './RunControls.hooks';

/** Drives `RunControls` with a live Harness `useRunConfig` (the shared config + the
 *  Deep toggle) so the chips, model/effort, mode, and the Scan gate are interactive in
 *  the story/test — the form state is owned here exactly as the HarnessView hook owns it
 *  in the app. */
function ConfiguredRunControls({
  isStarting,
  onScan,
}: {
  isStarting: boolean;
  onScan: () => void;
}) {
  const config = useRunConfig(false);
  return <RunControls config={config} isStarting={isStarting} onScan={onScan} />;
}

const meta = {
  title: 'Harness/RunControls',
  component: ConfiguredRunControls,
  parameters: { layout: 'fullscreen' },
  args: {
    isStarting: false,
    onScan: fn(),
  },
} satisfies Meta<typeof ConfiguredRunControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Starting: Story = {
  args: { isStarting: true },
};
