import type { Meta, StoryObj } from '@storybook/react-vite';

import { SettingsCard } from './SettingsCard';

const meta = {
  title: 'Settings/SettingsCard',
  component: SettingsCard,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 720 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SettingsCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Models: Story = {
  args: {
    icon: '✦',
    title: 'Models',
    subtitle: 'Pick the default model and reasoning effort for new tasks.',
    rows: [
      {
        label: 'Default model',
        hint: 'Used when a task has no explicit model.',
        control: <span className="font-mono text-sm text-foreground">Opus 4.8</span>,
      },
      {
        label: 'Reasoning effort',
        hint: 'Higher effort trades latency for depth.',
        control: <span className="font-mono text-sm text-foreground">High</span>,
      },
    ],
  },
};
