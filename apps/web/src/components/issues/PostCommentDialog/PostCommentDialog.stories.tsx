import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { PostCommentDialog } from './PostCommentDialog';

const BODY = [
  '### Nightcore validation',
  '',
  '**Verdict:** Valid · **Kind:** Bug report · **Confidence:** High',
  '',
  'Reproduced against the checkout.',
  '',
  '_Validated by Nightcore (claude-opus-4-8, 2026-07-05)._',
].join('\n');

const meta = {
  title: 'Issues/PostCommentDialog',
  component: PostCommentDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    open: true,
    body: BODY,
    loading: false,
    error: null,
    posting: false,
    onClose: fn(),
    onPost: fn(),
  },
} satisfies Meta<typeof PostCommentDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Loading: Story = { args: { body: '', loading: true } };

export const ErrorState: Story = {
  args: { body: '', error: 'Could not build the comment (no verdict).' },
};

export const Posting: Story = { args: { posting: true } };
