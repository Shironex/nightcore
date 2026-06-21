import { composeStories } from '@storybook/react-vite';
import { render } from 'vitest-browser-react';
import { expect, test, vi } from 'vitest';
import * as stories from './TaskDetail.stories';
import { deriveTaskDetailView } from './TaskDetail.hooks';
import { EMPTY_STREAM } from '../session-stream';
import { makeTask } from '../_fixtures';

const { Running, Failed, WaitingApproval, RunningWithPrompt } = composeStories(stories);

test('shows the plan and Approve / Refine / Reject for a waiting task', async () => {
  const onApprove = vi.fn();
  const screen = render(<WaitingApproval onApprove={onApprove} />);
  await expect.element(screen.getByText('Proposed plan')).toBeInTheDocument();
  await expect.element(screen.getByText(/Back up the users table/)).toBeInTheDocument();
  await screen.getByRole('button', { name: /approve/i }).click();
  expect(onApprove).toHaveBeenCalledWith('t-waiting');
  await expect.element(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
});

test('renders a parked permission prompt and relays the decision', async () => {
  const onRespondPermission = vi.fn();
  const screen = render(<RunningWithPrompt onRespondPermission={onRespondPermission} />);
  await expect.element(screen.getByText('Approval needed')).toBeInTheDocument();
  await screen.getByRole('button', { name: 'Allow' }).click();
  expect(onRespondPermission).toHaveBeenCalledWith('t-running', 'req-1', 'allow');
});

test('shows the live transcript heading and cancel control while running', async () => {
  const screen = render(<Running />);
  await expect.element(screen.getByText('Live transcript')).toBeInTheDocument();
  await expect
    .element(screen.getByRole('button', { name: /cancel run/i }))
    .toBeInTheDocument();
});

test('renders the persisted error for a failed task', async () => {
  const onRun = vi.fn();
  const screen = render(<Failed onRun={onRun} />);
  await expect
    .element(screen.getByText("cannot resolve 'sass-loader'"))
    .toBeInTheDocument();
});

test('deriveTaskDetailView prefers the live stream over persisted values', () => {
  const task = makeTask({ status: 'in_progress', costUsd: 0.1, summary: 'old' });
  const view = deriveTaskDetailView(task, {
    ...EMPTY_STREAM,
    answer: 'live',
    costUsd: 0.5,
  });
  expect(view.isRunning).toBe(true);
  expect(view.cost).toBe(0.5);
  expect(view.answer).toBe('live');
});
