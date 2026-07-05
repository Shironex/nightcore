import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import type { PrStatus, PrSummary, ReviewLens } from '@/lib/bridge';
import { useRunConfig } from '@/lib/useRunConfig';

import { ALL_LENSES } from '../prreview.constants';
import { PrWorkspace } from './PrWorkspace';

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

const STATUS: PrStatus = {
  state: 'OPEN',
  isDraft: false,
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  reviewDecision: '',
  checksPassed: 3,
  checksFailed: 0,
  checksPending: 0,
  baseRefName: 'main',
  url: SAMPLE.url,
  number: 40,
  unpushedCommits: 0,
};

/** Build a live run-config so the review section renders as in the app. */
function ConfiguredWorkspace({
  pr,
  prNumber,
  statusOverride,
  onOpenExternal,
}: {
  pr: PrSummary | null;
  prNumber: number;
  statusOverride: PrStatus | null;
  onOpenExternal: (url: string) => void;
}) {
  const config = useRunConfig<ReviewLens>(ALL_LENSES, false);
  return (
    <PrWorkspace
      prNumber={prNumber}
      pr={pr}
      onOpenExternal={onOpenExternal}
      statusOverride={statusOverride}
      review={{
        prNumber,
        mode: 'config',
        stream: null,
        configure: {
          config,
          isStarting: false,
          startError: null,
          onReview: fn(),
          onBackToResults: null,
        },
        running: { categories: [], findingCounts: {}, onCancel: fn() },
        results: {
          gridFindings: [],
          emptyMessage: '',
          selection: new Set<string>(),
          onToggleSelect: fn(),
          onOpenFinding: fn(),
          onNewReview: fn(),
          toolbar: {
            openCount: 0,
            onConvertAll: fn(),
            bulkConverting: false,
            bulkProgress: { done: 0, total: 0, failed: 0 },
            bulkStatusMessage: '',
            bulkError: null,
            selectedCount: 0,
            canPost: false,
            requestPost: fn(),
            ownPr: false,
            addressCount: 0,
            canAddress: false,
            fixRunning: false,
            requestAddress: fn(),
            addressError: null,
          },
          fix: null,
        },
        history: { items: [], viewingPastRun: false, onBackToLatest: fn() },
      }}
    />
  );
}

const meta = {
  title: 'PrReview/PrWorkspace',
  component: ConfiguredWorkspace,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="h-[820px] overflow-y-auto">
        <Story />
      </div>
    ),
  ],
  args: { pr: SAMPLE, prNumber: 40, statusOverride: STATUS, onOpenExternal: fn() },
} satisfies Meta<typeof ConfiguredWorkspace>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Selected: Story = {};

/** A typed number for a PR not in the open list — reviewed by number. */
export const TypedNumberNotInList: Story = {
  args: { pr: null, prNumber: 999, statusOverride: null },
};
