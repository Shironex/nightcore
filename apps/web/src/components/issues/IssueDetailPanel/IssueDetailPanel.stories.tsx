import type { Meta, StoryObj } from '@storybook/react-vite';

import type { IssueDetail, IssueSummary } from '@/lib/bridge';

import { IssueDetailPanel } from './IssueDetailPanel';

const ISSUE: IssueSummary = {
  number: 128,
  title: 'Crash when opening a project with no git remote',
  state: 'open',
  labels: ['bug', 'crash'],
  author: 'octocat',
  createdAt: '2026-06-30T10:00:00Z',
  updatedAt: '2026-07-05T10:00:00Z',
  commentCount: 1,
  linkedPrs: [{ number: 131, title: 'Guard the no-remote path', state: 'open' }],
};

const DETAIL: IssueDetail = {
  body: '## Steps to reproduce\n\n1. Open a folder with **no** `origin` remote\n2. Boom 💥\n\nStack trace attached.',
  comments: [
    {
      id: 'c1',
      author: 'maintainer',
      body: 'Thanks — can you share `git remote -v` output?',
      createdAt: '2026-07-04T09:00:00Z',
    },
  ],
};

const meta = {
  title: 'Issues/IssueDetailPanel',
  component: IssueDetailPanel,
  parameters: { layout: 'fullscreen' },
  args: {
    issue: ISSUE,
    detail: DETAIL,
    loading: false,
    error: null,
  },
} satisfies Meta<typeof IssueDetailPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoSelection: Story = { args: { issue: null, detail: null } };

export const Loading: Story = { args: { detail: null, loading: true } };

export const ErrorState: Story = {
  args: { detail: null, error: 'Could not read the issue (gh failed).' },
};

export const NoDescription: Story = {
  args: { detail: { body: '', comments: [] } },
};
