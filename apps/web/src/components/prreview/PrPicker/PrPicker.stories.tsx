import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import type { PrSummary } from '@/lib/bridge';

import { PrPicker } from './PrPicker';

function sample(over: Partial<PrSummary> & Pick<PrSummary, 'number'>): PrSummary {
  return {
    title: 'Untitled',
    state: 'OPEN',
    headRefName: 'branch',
    author: 'octocat',
    isDraft: false,
    createdAt: '2026-06-20T09:00:00Z',
    updatedAt: '2026-07-02T12:00:00Z',
    url: `https://github.com/o/r/pull/${over.number}`,
    labels: [],
    body: '',
    ...over,
  };
}

const SAMPLE: PrSummary[] = [
  sample({
    number: 128,
    title: 'Harden the worktree isolation gate',
    headRefName: 'nc/worktree-gate',
    author: 'shirone',
    labels: [{ name: 'security', color: 'd73a4a' }],
  }),
  sample({
    number: 127,
    title: 'Add the PR review scan sibling',
    headRefName: 'feat/pr-review',
    author: 'alice',
    isDraft: true,
  }),
  sample({
    number: 119,
    title: 'Flight-recorder ledger for the runtime tiers',
    headRefName: 'feat/ledger',
    author: 'bob',
  }),
];

const meta = {
  title: 'PrReview/PrPicker',
  component: PrPicker,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="flex h-[560px] w-[400px] flex-col border border-border">
        <Story />
      </div>
    ),
  ],
  args: {
    prs: SAMPLE,
    loading: false,
    error: null,
    value: null,
    onChange: fn(),
    onRefresh: fn(),
  },
} satisfies Meta<typeof PrPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};

export const Selected: Story = {
  args: { value: 127 },
};

/** Registry badges: #128 has a review streaming, #127's latest completed run
 *  left 3 open findings. */
export const WithRunBadges: Story = {
  args: { runningPrs: [128], findingCounts: { 127: 3 } },
};

export const Loading: Story = {
  args: { prs: [], loading: true },
};

export const Empty: Story = {
  args: { prs: [] },
};

export const Error: Story = {
  args: {
    prs: [],
    error: 'gh: no default remote repository detected',
  },
};
