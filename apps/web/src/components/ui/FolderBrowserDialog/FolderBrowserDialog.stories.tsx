import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { FolderBrowserDialog } from './FolderBrowserDialog';

// Outside Tauri the browser degrades to a synthetic in-memory filesystem
// (`bridge/mocks`), so every story here is fully navigable without a real backend.
// The mock opens at `/Users/you` (projects, Documents, Downloads, Desktop). Behavior
// (navigation, search, recents, choose, error/empty states) is exercised by
// `FolderBrowserDialog.test.tsx`; these stories are the visual gallery.
const meta = {
  title: 'UI/FolderBrowserDialog',
  component: FolderBrowserDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    open: true,
    title: 'Open a terminal here',
    description: 'Navigate to a folder, or double-click to pick it.',
    selectLabel: 'Open terminal here',
    onSelect: fn(),
    onClose: fn(),
  },
} satisfies Meta<typeof FolderBrowserDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The default landing (home directory) with its folders listed. */
export const Default: Story = {};

/** Opened at a specific folder — a repo listing with a git-marked child. */
export const InitialPath: Story = {
  args: { initialPath: '/Users/you/projects' },
};

/** A deeper folder to show the breadcrumb trail with several segments. */
export const DeepPath: Story = {
  args: { initialPath: '/Users/you/projects/nightcore/apps' },
};
