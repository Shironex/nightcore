import type { TaskStatus } from '@/lib/bridge';

/** A board column: its key, label, the statuses it groups, the design's status
 *  dot color, an optional roadmap badge, and whether it offers a "Clear". */
export interface ColumnDef {
  key: string;
  title: string;
  statuses: TaskStatus[];
  /** oklch color for the column's status dot (and glow), from the design. */
  dotColor: string;
  /** Roadmap tag carried from the design (e.g. the waiting column is M3). */
  badge?: string;
  /** Verified/Failed columns offer a "Clear" affordance when non-empty. */
  clearable?: boolean;
}

/** The five board columns, in the design's order:
 *  Backlog · In Progress · Waiting Approval (M3) · Verified · Failed. */
export const COLUMNS: ColumnDef[] = [
  {
    key: 'backlog',
    title: 'Backlog',
    statuses: ['backlog', 'ready'],
    dotColor: 'oklch(62% .02 290)',
  },
  {
    key: 'in_progress',
    title: 'In Progress',
    statuses: ['in_progress'],
    dotColor: 'oklch(80% .14 75)',
  },
  {
    key: 'waiting_approval',
    title: 'Waiting Approval',
    statuses: ['waiting_approval'],
    dotColor: 'oklch(74% .13 248)',
    badge: 'M3',
  },
  {
    key: 'done',
    title: 'Verified',
    statuses: ['done'],
    dotColor: 'oklch(76% .15 152)',
    clearable: true,
  },
  {
    key: 'failed',
    title: 'Failed',
    statuses: ['failed'],
    dotColor: 'oklch(66% .2 22)',
    clearable: true,
  },
];

/** Human label for a status. */
export const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  ready: 'Ready',
  in_progress: 'Running',
  waiting_approval: 'Waiting Approval',
  done: 'Verified',
  failed: 'Failed',
};

/** Whether a status represents an actively running task (pulses its dot). */
export function isActive(status: TaskStatus): boolean {
  return status === 'in_progress';
}

/** Tailwind background class for a status dot — maps onto the design tokens. */
export const STATUS_DOT_COLOR: Record<TaskStatus, string> = {
  backlog: 'bg-muted',
  ready: 'bg-info',
  in_progress: 'bg-warning',
  waiting_approval: 'bg-info',
  done: 'bg-success',
  failed: 'bg-destructive',
};

/** Tailwind text class for a status label. */
export const STATUS_TEXT: Record<TaskStatus, string> = {
  backlog: 'text-muted-foreground',
  ready: 'text-info',
  in_progress: 'text-warning',
  waiting_approval: 'text-info',
  done: 'text-success',
  failed: 'text-destructive',
};

export function formatCost(costUsd: number): string {
  return `$${costUsd.toFixed(2)}`;
}

/** Map a stored model id (or already-display name) to its display name. The
 *  store may hold ids like `opus-4.8` / `sonnet-4.6` / `haiku-4.5`, or the
 *  design's display names directly; both resolve to the canonical label.
 *  Never returns a literal "default model" — falls back to the design default. */
export function modelDisplayName(model: string | null): string {
  const id = (model ?? '').toLowerCase();
  if (id.includes('opus')) return 'Opus 4.8';
  if (id.includes('sonnet')) return 'Sonnet 4.8';
  if (id.includes('haiku')) return 'Haiku 4.5';
  return 'Opus 4.8';
}

/** The colored dot beside a model badge, keyed on model family (design palette):
 *  Opus → primary, Sonnet → blue, Haiku → green. */
export function modelDotColor(model: string | null): string {
  const name = modelDisplayName(model);
  if (name.startsWith('Sonnet')) return 'oklch(74% .13 248)';
  if (name.startsWith('Haiku')) return 'oklch(76% .15 152)';
  return 'var(--nc-primary)';
}
