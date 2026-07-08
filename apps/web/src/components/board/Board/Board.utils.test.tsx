import { expect, test } from 'vitest';

import { BLOCKED_TASK, ORPHAN_BRANCH_TASK, TASKS_BY_STATUS, WORKTREES } from '../_fixtures';
import {
  computeBlockedIds,
  groupTasksByColumn,
  isGhostWorktree,
  matchesQuery,
} from './Board.utils';

test('groupTasksByColumn places each task in its status column, newest first', () => {
  const grouped = groupTasksByColumn([
    { ...TASKS_BY_STATUS.backlog, updatedAt: 1 },
    { ...TASKS_BY_STATUS.ready, updatedAt: 2 },
    TASKS_BY_STATUS.done,
  ]);
  const backlog = grouped.find((c) => c.def.key === 'backlog');
  expect(backlog?.tasks.map((t) => t.updatedAt)).toEqual([2, 1]);
  expect(grouped.find((c) => c.def.key === 'done')?.tasks).toHaveLength(1);
});

test('computeBlockedIds flags a backlog task whose dependency is unfinished', () => {
  const dep = { ...TASKS_BY_STATUS.in_progress, title: 'Deployment configuration' };
  const blocked = computeBlockedIds([BLOCKED_TASK, dep]);
  expect(blocked.has(BLOCKED_TASK.id)).toBe(true);
});

test('computeBlockedIds clears the block once the dependency is verified', () => {
  const dep = {
    ...TASKS_BY_STATUS.done,
    title: 'Deployment configuration',
    status: 'done' as const,
  };
  const blocked = computeBlockedIds([BLOCKED_TASK, dep]);
  expect(blocked.has(BLOCKED_TASK.id)).toBe(false);
});

test('matchesQuery matches title and description, case-insensitively', () => {
  expect(matchesQuery(TASKS_BY_STATUS.done, 'AUTH')).toBe(true);
  expect(matchesQuery(TASKS_BY_STATUS.done, 'nonexistent')).toBe(false);
  expect(matchesQuery(TASKS_BY_STATUS.done, '')).toBe(true);
});

// Regression: after a merge removes the worktree AND clears its task's branch, the
// active selection points at a branch that exists on neither a live worktree nor any
// task. Left un-reset, the board stays scoped to that dead branch → empty columns
// until the user switches projects. isGhostWorktree drives the self-heal to Main.
test('isGhostWorktree flags a merged-and-removed branch (no worktree, no task)', () => {
  // The merged task's branch was set to null; no worktree remains on nc/merged.
  const tasks = [{ ...TASKS_BY_STATUS.done, branch: null }];
  expect(isGhostWorktree('nc/merged', tasks, [])).toBe(true);
});

test('isGhostWorktree never flags Main', () => {
  expect(isGhostWorktree(null, [ORPHAN_BRANCH_TASK], WORKTREES)).toBe(false);
});

test('isGhostWorktree keeps a selection backed by a live worktree', () => {
  // nc/api-client has a live worktree in the WORKTREES fixture.
  expect(isGhostWorktree('nc/api-client', [], WORKTREES)).toBe(false);
});

test('isGhostWorktree keeps a task branch whose worktree dir does not exist yet', () => {
  // ORPHAN_BRANCH_TASK (nc/shiki-trim) has a branch but no live worktree — a valid
  // tab, so it must NOT be cleared as a ghost (guards against over-healing).
  expect(isGhostWorktree('nc/shiki-trim', [ORPHAN_BRANCH_TASK], [])).toBe(false);
});
