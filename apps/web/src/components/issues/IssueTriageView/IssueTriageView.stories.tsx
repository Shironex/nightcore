import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { ToastProvider } from '@/components/ui';

import { IssueTriageView } from './IssueTriageView';

const meta = {
  title: 'Issues/IssueTriageView',
  component: IssueTriageView,
  parameters: { layout: 'fullscreen' },
  // The view surfaces action failures through the toast channel, so the provider
  // wraps it here just as it does in the app (and in AppShell's story).
  decorators: [
    (Story) => (
      <ToastProvider>
        <Story />
      </ToastProvider>
    ),
  ],
  args: {
    projectPath: '/Users/dev/acme',
    projectName: 'acme',
    onGotoBoard: fn(),
  },
} satisfies Meta<typeof IssueTriageView>;

export default meta;
type Story = StoryObj<typeof meta>;

// Outside Tauri the bridge returns its fallbacks (no issues, no runs, a no-op event
// listener), so this renders the idle project view with an empty issue list.
export const Idle: Story = {};

export const NoProject: Story = {
  args: { projectPath: null, projectName: null },
};
