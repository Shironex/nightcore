import { composeStories } from '@storybook/react-vite';
import { render } from 'vitest-browser-react';
import { expect, test, vi } from 'vitest';
import { Column } from './Column';
import { DRAG_TASK_ID } from './Column.hooks';
import { TASKS_BY_STATUS } from '../_fixtures';
import * as stories from './Column.stories';

const { Empty, InProgress, WaitingApproval, Verified } = composeStories(stories);

/** Fire a synthetic HTML5 drop carrying `taskId` at `el`. We assert the move via
 *  a `drop` event rather than a full pointer-driven native drag, which is flaky in
 *  the browser runner. */
function fireDrop(el: Element, taskId: string): void {
  const dataTransfer = new DataTransfer();
  dataTransfer.setData(DRAG_TASK_ID, taskId);
  el.dispatchEvent(
    new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }),
  );
}

test('shows the custom empty placeholder when a column has no tasks', async () => {
  const screen = render(<Empty />);
  await expect.element(screen.getByText('Add a task to begin')).toBeInTheDocument();
});

test('renders the task title for a populated column', async () => {
  const screen = render(<InProgress />);
  await expect.element(screen.getByText('Generate API client')).toBeInTheDocument();
});

test('renders the roadmap badge beside the column title', async () => {
  const screen = render(<WaitingApproval />);
  await expect.element(screen.getByText('M3')).toBeInTheDocument();
});

test('fires onClear from a clearable, non-empty column', async () => {
  const onClear = vi.fn();
  const screen = render(<Verified onClear={onClear} />);
  await screen.getByRole('button', { name: /clear/i }).click();
  expect(onClear).toHaveBeenCalled();
});

test('dropping a card on a droppable column moves it to that column status', async () => {
  const onMoveTask = vi.fn();
  const screen = render(
    <Column
      title="Backlog"
      tasks={[]}
      dotColor="oklch(62% .02 290)"
      selectedId={null}
      blockedIds={new Set()}
      logCounts={{}}
      dropStatus="backlog"
      emptyText="Add a task to begin"
      onSelect={vi.fn()}
      onMoveTask={onMoveTask}
    />,
  );
  const zone = screen.container.querySelector('div.overflow-auto');
  expect(zone).not.toBeNull();
  fireDrop(zone as Element, 't-done');
  expect(onMoveTask).toHaveBeenCalledWith('t-done', 'backlog');
});

test('the In Progress column rejects drops (run-only target)', async () => {
  const onMoveTask = vi.fn();
  const screen = render(
    <Column
      title="In Progress"
      tasks={[TASKS_BY_STATUS.in_progress]}
      dotColor="oklch(80% .14 75)"
      selectedId={null}
      blockedIds={new Set()}
      logCounts={{}}
      dropStatus="in_progress"
      onSelect={vi.fn()}
      onMoveTask={onMoveTask}
    />,
  );
  const zone = screen.container.querySelector('div.overflow-auto');
  fireDrop(zone as Element, 't-running');
  expect(onMoveTask).not.toHaveBeenCalled();
});
