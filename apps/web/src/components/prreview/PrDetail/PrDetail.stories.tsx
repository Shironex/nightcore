import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import type { PrSummary } from '@/lib/bridge';

import { useRunConfig } from '../RunControls';
import { PrDetail } from './PrDetail';

const SAMPLE: PrSummary = {
  number: 40,
  title: 'feat(downloader): YouTube cookie auth for age-restricted videos',
  state: 'OPEN',
  headRefName: 'feat/cookie-auth',
  author: 'Shironex',
  isDraft: false,
  createdAt: '2026-04-09T10:00:00Z',
  updatedAt: '2026-04-10T10:00:00Z',
  url: 'https://github.com/Shironex/shiranami/pull/40',
  labels: [
    { name: 'enhancement', color: 'a2eeef' },
    { name: 'P2-medium', color: 'fbca04' },
    { name: 'area:electron', color: '0e8a16' },
  ],
  body: '## Background\n\nUsers are reporting download failures on age-restricted videos.\n\n```\nERROR: Sign in to confirm your age.\n```\n',
};

/** Build a live run-config so the lens chips + Review gate render as in the app. */
function ConfiguredPrDetail({
  pr,
  selectedNumber,
  isStarting,
  onReview,
  onOpenExternal,
}: {
  pr: PrSummary | null;
  selectedNumber: number | null;
  isStarting: boolean;
  onReview: () => void;
  onOpenExternal: (url: string) => void;
}) {
  const config = useRunConfig(false);
  return (
    <PrDetail
      pr={pr}
      selectedNumber={selectedNumber}
      config={config}
      isStarting={isStarting}
      onReview={onReview}
      onOpenExternal={onOpenExternal}
    />
  );
}

const meta = {
  title: 'PrReview/PrDetail',
  component: ConfiguredPrDetail,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="flex h-[720px] flex-col">
        <Story />
      </div>
    ),
  ],
  args: {
    pr: SAMPLE,
    selectedNumber: 40,
    isStarting: false,
    onReview: fn(),
    onOpenExternal: fn(),
  },
} satisfies Meta<typeof ConfiguredPrDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Selected: Story = {};

export const NothingSelected: Story = {
  args: { pr: null, selectedNumber: null },
};

export const TypedNumberNotInList: Story = {
  args: { pr: null, selectedNumber: 999 },
};
