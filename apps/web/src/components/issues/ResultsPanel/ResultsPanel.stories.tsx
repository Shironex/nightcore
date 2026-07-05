import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { EMPTY_ISSUE_TRIAGE_STREAM, type IssueTriageStream } from '../issue-stream';
import type { IssueVerdictView } from '../issue-triage.types';
import { ResultsPanel } from './ResultsPanel';

const VERDICT: IssueVerdictView = {
  issueKind: 'bug_report',
  verdict: 'valid',
  confidence: 'high',
  reasoning: 'The crash is reproducible: `openProject` dereferences the remote before checking it exists.',
  bugConfirmed: true,
  relatedFiles: ['src/git/remote.ts', 'src/project/open.ts'],
  estimatedComplexity: 'moderate',
  proposedPlan: '1. Guard the missing remote in `openProject`\n2. Add a regression test',
  missingInfo: [],
  prAnalysis: {
    hasOpenPr: true,
    prNumber: 131,
    prFixesIssue: false,
    prSummary: 'PR #131 guards the read path but not the write path.',
    recommendation: 'pr_needs_work',
  },
};

const COMPLETED: IssueTriageStream = {
  ...EMPTY_ISSUE_TRIAGE_STREAM,
  runId: 'val-1',
  issueNumber: 128,
  status: 'completed',
  model: 'claude-opus-4-8',
  result: VERDICT,
  validatedAt: 1000,
};

const meta = {
  title: 'Issues/ResultsPanel',
  component: ResultsPanel,
  args: {
    stream: COMPLETED,
    stale: false,
    onPostComment: fn(),
    onConvertToTask: fn(),
    onGotoBoard: fn(),
  },
} satisfies Meta<typeof ResultsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Valid: Story = {};

export const Stale: Story = { args: { stale: true } };

export const NeedsClarification: Story = {
  args: {
    stream: {
      ...COMPLETED,
      result: {
        ...VERDICT,
        issueKind: 'question',
        verdict: 'needs_clarification',
        confidence: 'low',
        bugConfirmed: null,
        prAnalysis: null,
        proposedPlan: null,
        missingInfo: ['exact reproduction steps', 'the `git remote -v` output'],
      },
    },
  },
};

export const Posted: Story = {
  args: {
    stream: {
      ...COMPLETED,
      postedAt: 2000,
      postedCommentUrl: 'https://github.com/x/y/issues/128#issuecomment-1',
    },
  },
};

export const Converted: Story = {
  args: { stream: { ...COMPLETED, linkedTaskId: 'task-9' } },
};
