import type { Meta, StoryObj } from '@storybook/react-vite';
import { AppShell } from './AppShell';

/** The full app shell. In Storybook the bridge runs in browser mode, so it seeds
 *  from mock data (one project, default settings) and commands no-op. */
const meta = {
  title: 'App/AppShell',
  component: AppShell,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div style={{ height: '100vh' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AppShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
