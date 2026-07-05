import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { ConvertToTaskDialog } from './ConvertToTaskDialog';

const meta = {
  title: 'Issues/ConvertToTaskDialog',
  component: ConvertToTaskDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    open: true,
    issueNumber: 128,
    issueTitle: 'Crash when opening a project with no git remote',
    suggestedKind: 'Build',
    complexityLabel: 'Moderate',
    effortLabel: 'Medium',
    converting: false,
    alreadyLinked: false,
    error: null,
    onClose: fn(),
    onConvert: fn(),
    onGotoBoard: fn(),
  },
} satisfies Meta<typeof ConvertToTaskDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Build: Story = {};

export const ComplexFeature: Story = {
  args: {
    suggestedKind: 'Decompose',
    issueTitle: 'Add a full plugin marketplace',
    complexityLabel: 'Very complex',
    effortLabel: 'Large',
  },
};

export const AlreadyLinked: Story = { args: { alreadyLinked: true } };

export const Converting: Story = { args: { converting: true } };

export const ErrorState: Story = {
  args: { error: 'Could not create the task — the store rejected the write.' },
};
