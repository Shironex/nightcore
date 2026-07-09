import type { Task, WorktreeInfo } from '@/lib/bridge';
import type { ActiveWorktree } from '@/lib/worktrees-context';

import { type ColumnDef, COLUMNS } from '../status';

/** A board column paired with the tasks currently grouped into it. */
export interface BoardColumn {
  def: ColumnDef;
  tasks: Task[];
}

/** Statuses that count as "finished" when resolving a dependency. */
const SETTLED: ReadonlySet<Task['status']> = new Set(['done']);

/**
 * A backlog task is blocked when any of its dependencies (matched by task
 * title) is not yet verified (i.e. not in the SETTLED set). Returns the set
 * of blocked task ids.
 */
export function computeBlockedIds(tasks: Task[]): Set<string> {
  const byTitle = new Map(tasks.map((t) => [t.title, t]));
  const blocked = new Set<string>();
  for (const task of tasks) {
    if (task.status !== 'backlog' && task.status !== 'ready') continue;
    const isBlocked = task.dependencies.some((dep) => {
      const target = byTitle.get(dep);
      return target !== undefined && !SETTLED.has(target.status);
    });
    if (isBlocked) blocked.add(task.id);
  }
  return blocked;
}

/** Group tasks into the board's columns, newest-updated first within each. */
export function groupTasksByColumn(tasks: Task[]): BoardColumn[] {
  return COLUMNS.map((def) => ({
    def,
    tasks: tasks
      .filter((task) => def.statuses.includes(task.status))
      .sort((a, b) => b.updatedAt - a.updatedAt),
  }));
}

/** Case-insensitive title/description keyword match. Empty query matches all. */
export function matchesQuery(task: Task, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return `${task.title} ${task.description}`.toLowerCase().includes(q);
}

/**
 * Whether the active worktree selection is a "ghost" — its branch no longer
 * exists on any live worktree directory OR any task. A merge (or a discard) removes
 * the worktree AND clears the owning task's branch (`t.branch = None`), so the tab
 * vanishes but the shared selection lingers, and `filterTasksByWorktree` then scopes
 * the board to a dead branch → every column renders empty until the user switches
 * projects. Main (`null`) is never a ghost. Mirrors the union `useWorktreeTabs`
 * builds tabs from (live worktrees ∪ task branches), so "no tab exists for `active`"
 * ⇔ ghost — meaning a still-live worktree, or a task whose worktree dir hasn't
 * materialized yet, is correctly NOT treated as stale.
 */
export function isGhostWorktree(
  active: ActiveWorktree,
  tasks: Task[],
  worktrees: WorktreeInfo[],
): boolean {
  if (active === null) return false;
  if (worktrees.some((worktree) => worktree.branch === active)) return false;
  return !tasks.some((task) => task.branch === active);
}
