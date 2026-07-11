import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';

import type { BranchInfo } from '@/lib/bridge';

import { portaledSurface } from '../../../../.storybook/test-utils';
import { CreateWorktreeDialog } from './CreateWorktreeDialog';

const BRANCHES: BranchInfo[] = [
  { name: 'main', isRemote: false, isCurrent: true, ahead: 0, behind: 0 },
  { name: 'dev', isRemote: false, isCurrent: false, ahead: 0, behind: 0 },
  { name: 'origin/main', isRemote: true, isCurrent: false, ahead: 0, behind: 0 },
];

const meta = {
  title: 'Terminal/CreateWorktreeDialog',
  component: CreateWorktreeDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    open: true,
    branches: BRANCHES,
    onConfirm: fn(),
    onClose: fn(),
  },
} satisfies Meta<typeof CreateWorktreeDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The empty create form: name, "Create a new branch" (on by default), base picker. */
export const Default: Story = {};

/** A create is in flight — the form is disabled and a "Creating…" note shows. */
export const Busy: Story = { args: { busy: true } };

/** A create error (name collision) surfaced inline; the dialog stays open. */
export const WithError: Story = {
  args: { error: 'a worktree named "spike" already exists' },
};

/** Play test: typing a name shows the derived `term/<slug>` preview. */
export const SlugPreview: Story = {
  play: async () => {
    const canvas = portaledSurface();
    await userEvent.type(canvas.getByLabelText('Name'), 'Spike Auth Refactor');
    await expect(canvas.getByText('branch: term/spike-auth-refactor')).toBeInTheDocument();
  },
};

/** Play test: confirming emits the collected request. */
export const ConfirmEmitsRequest: Story = {
  play: async ({ args }) => {
    const canvas = portaledSurface();
    await userEvent.type(canvas.getByLabelText('Name'), 'my shell');
    await userEvent.click(canvas.getByRole('button', { name: 'Create worktree' }));
    await expect(args.onConfirm).toHaveBeenCalledWith({
      name: 'my shell',
      createBranch: true,
      base: '',
    });
  },
};
