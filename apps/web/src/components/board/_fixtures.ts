import type { Task, TaskStatus } from '@/lib/bridge';

/** Build a Task fixture for stories/tests. Mirrors the frozen M1 shape. */
export function makeTask(overrides: Partial<Task> = {}): Task {
  const now = 1_718_900_000_000;
  return {
    id: overrides.id ?? 'task-1',
    title: overrides.title ?? 'Webpack → Vite migration',
    description:
      overrides.description ??
      'Migrate the build pipeline from Webpack to Vite for faster cold starts.',
    status: overrides.status ?? 'backlog',
    dependencies: overrides.dependencies ?? [],
    model: overrides.model ?? 'opus-4.8',
    branch: overrides.branch ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    sessionId: overrides.sessionId ?? null,
    summary: overrides.summary ?? null,
    error: overrides.error ?? null,
    costUsd: overrides.costUsd ?? null,
  };
}

/** One task per board status, for "each status" card stories. Enriched to match
 *  the design's card anatomy: model badges, branches, costs, deps, and errors. */
export const TASKS_BY_STATUS: Record<TaskStatus, Task> = {
  backlog: makeTask({ id: 't-backlog', status: 'backlog' }),
  ready: makeTask({ id: 't-ready', status: 'ready', title: 'Add dark-mode toggle' }),
  in_progress: makeTask({
    id: 't-running',
    status: 'in_progress',
    title: 'Generate API client',
    model: 'sonnet-4.6',
    branch: 'nc/api-client',
    costUsd: 0.18,
  }),
  waiting_approval: makeTask({
    id: 't-waiting',
    status: 'waiting_approval',
    title: 'Apply destructive migration',
    branch: 'nc/destructive-migration',
    costUsd: 0.42,
  }),
  done: makeTask({
    id: 't-done',
    status: 'done',
    title: 'Wire up auth guard',
    branch: 'nc/auth-guard',
    costUsd: 0.42,
  }),
  failed: makeTask({
    id: 't-failed',
    status: 'failed',
    title: 'Webpack → Vite migration',
    branch: 'nc/vite-migrate',
    error: "cannot resolve 'sass-loader'",
    costUsd: 0.58,
  }),
};

/** A backlog task blocked on an unfinished dependency — exercises the card's
 *  blocked chip and the disabled "Blocked" run action. */
export const BLOCKED_TASK: Task = makeTask({
  id: 't-blocked',
  status: 'backlog',
  title: 'Worktree cleanup policy',
  description:
    'Remove per-task worktrees once a task is verified and merged.',
  model: 'haiku-4.5',
  dependencies: ['Deployment configuration'],
});
