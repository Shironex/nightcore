import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { BoltIcon, ToolbarOption } from '@/components/ui';

import { AutoModeOptions } from './AutoModeOptions';

const meta = {
  title: 'Board/AutoModeOptions',
  component: AutoModeOptions,
  args: {
    autoCommitOnVerified: false,
    onAutoCommitChange: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 24, width: 420 }}>
        <ToolbarOption
          label="Auto Mode"
          on={false}
          onToggle={() => {}}
          icon={<BoltIcon size={14} className="text-muted-foreground" />}
          settingsLabel="Auto Mode options"
          settings={<Story />}
        />
      </div>
    ),
  ],
} satisfies Meta<typeof AutoModeOptions>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Collapsed — settings content inside a ToolbarOption, as on the board header. */
export const Collapsed: Story = {};

/** Auto-commit already enabled (open the gear to see the switch on). */
export const Enabled: Story = { args: { autoCommitOnVerified: true } };
