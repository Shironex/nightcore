import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import type { IssueSummary } from '@/lib/bridge';

import { IssueList } from './IssueList';

const ISSUES: IssueSummary[] = [
  {
    number: 128,
    title: 'Crash when opening a project with no git remote',
    state: 'open',
    labels: ['bug', 'crash'],
    author: 'octocat',
    createdAt: '2026-06-30T10:00:00Z',
    updatedAt: '2026-07-05T10:00:00Z',
    commentCount: 3,
    linkedPrs: [{ number: 131, title: 'Guard the no-remote path', state: 'open' }],
  },
  {
    number: 127,
    title: 'Feature: dark-mode toggle in settings',
    state: 'open',
    labels: ['enhancement'],
    author: 'contributor',
    createdAt: '2026-06-28T10:00:00Z',
    updatedAt: '2026-07-01T10:00:00Z',
    commentCount: 0,
    linkedPrs: [],
  },
];

const meta = {
  title: 'Issues/IssueList',
  component: IssueList,
  parameters: { layout: 'fullscreen' },
  args: {
    issues: ISSUES,
    totalCount: ISSUES.length,
    loading: false,
    error: null,
    filter: '',
    onFilterChange: fn(),
    selectedNumber: 128,
    onSelect: fn(),
    onRetry: fn(),
    badgeByNumber: { 128: 'validated', 127: 'stale' },
  },
} satisfies Meta<typeof IssueList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Loading: Story = { args: { loading: true } };

export const ErrorState: Story = {
  args: { error: 'gh is not authenticated — run `gh auth login`.' },
};

export const Empty: Story = { args: { issues: [], totalCount: 0 } };

export const NoMatches: Story = { args: { issues: [], totalCount: 5, filter: 'zzz' } };
