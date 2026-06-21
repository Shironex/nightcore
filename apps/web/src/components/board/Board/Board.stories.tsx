import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Board } from './Board';
import { BLOCKED_TASK, TASKS_BY_STATUS } from '../_fixtures';

const meta = {
  title: 'Board/Board',
  component: Board,
  parameters: { layout: 'fullscreen' },
  args: {
    projectPath: '~/dev/nightcore',
    projectBranch: 'main',
    concurrency: 3,
    selectedId: null,
    logCounts: { 't-running': 7 },
    onSelect: fn(),
    onNewTask: fn(),
    onRun: fn(),
    onCancel: fn(),
    onDelete: fn(),
    onClearColumn: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ height: '80vh', width: '100%' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Board>;

export default meta;
type Story = StoryObj<typeof meta>;

const ALL_TASKS = [
  TASKS_BY_STATUS.backlog,
  TASKS_BY_STATUS.ready,
  BLOCKED_TASK,
  TASKS_BY_STATUS.in_progress,
  TASKS_BY_STATUS.waiting_approval,
  TASKS_BY_STATUS.done,
  TASKS_BY_STATUS.failed,
];

export const Empty: Story = {
  args: {
    tasks: [TASKS_BY_STATUS.backlog],
  },
};

export const Populated: Story = {
  args: {
    tasks: ALL_TASKS,
    selectedId: 't-running',
  },
};

/** Play test: typing a keyword filters cards to title/description matches. */
export const SearchFilters: Story = {
  args: { tasks: ALL_TASKS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Generate API client')).toBeInTheDocument();
    await userEvent.type(
      canvas.getByPlaceholderText('Search tasks by keyword…'),
      'auth guard',
    );
    await expect(canvas.queryByText('Generate API client')).not.toBeInTheDocument();
    await expect(canvas.getByText('Wire up auth guard')).toBeInTheDocument();
  },
};

/** Play test: the card-style switcher toggles the active look. */
export const SwitchesCardStyle: Story = {
  args: { tasks: ALL_TASKS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const flat = canvas.getByRole('button', { name: /^flat$/i });
    await userEvent.click(flat);
    await expect(flat).toHaveClass('bg-primary');
  },
};
