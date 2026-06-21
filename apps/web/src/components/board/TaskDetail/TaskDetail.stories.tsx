import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { TaskDetail } from './TaskDetail';
import { EMPTY_STREAM } from '../session-stream';
import { TASKS_BY_STATUS, makeTask } from '../_fixtures';

const meta = {
  title: 'Board/TaskDetail',
  component: TaskDetail,
  parameters: { layout: 'fullscreen' },
  args: {
    anyRunning: false,
    onClose: fn(),
    onRun: fn(),
    onCancel: fn(),
    onDelete: fn(),
    onRespondPermission: fn(),
    onApprove: fn(),
    onReject: fn(),
    onRefine: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ display: 'flex', justifyContent: 'flex-end', height: '80vh' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TaskDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EmptyBacklog: Story = {
  args: { task: TASKS_BY_STATUS.backlog, stream: undefined },
};

export const Running: Story = {
  args: {
    task: TASKS_BY_STATUS.in_progress,
    anyRunning: true,
    stream: {
      ...EMPTY_STREAM,
      answer: 'Reading vite.config.ts…\nGenerating the typed client from the OpenAPI spec.',
      tools: [
        { id: 1, toolName: 'Read' },
        { id: 2, toolName: 'Edit' },
      ],
      costUsd: 0.18,
    },
  },
};

export const Done: Story = {
  args: {
    task: makeTask({
      id: 't-done',
      status: 'done',
      title: 'Wire up auth guard',
      summary: 'Added the auth middleware and covered it with tests.',
      costUsd: 0.42,
    }),
    stream: undefined,
  },
};

/** A plan-mode run paused at `ExitPlanMode`: the plan + Approve/Refine/Reject. */
export const WaitingApproval: Story = {
  args: {
    task: makeTask({
      id: 't-waiting',
      status: 'waiting_approval',
      title: 'Apply destructive migration',
      plan: '1. Back up the users table\n2. Add the new column\n3. Backfill from email',
      branch: 'nc/destructive-migration',
    }),
    stream: undefined,
  },
};

/** A running task with a parked permission prompt rendered in the panel. */
export const RunningWithPrompt: Story = {
  args: {
    task: TASKS_BY_STATUS.in_progress,
    anyRunning: true,
    stream: undefined,
    prompts: [
      {
        taskId: 't-running',
        requestId: 'req-1',
        toolName: 'Bash',
        input: { command: 'rm -rf dist && bun run build' },
      },
    ],
  },
};

export const Failed: Story = {
  args: { task: TASKS_BY_STATUS.failed, stream: undefined },
};
