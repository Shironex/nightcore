import {
  AgentsIcon,
  BoltIcon,
  BranchIcon,
  Kbd,
  PlusIcon,
  SearchIcon,
} from '@/components/ui';
import type { CardStyle } from '../TaskCard';
import { Column } from '../Column';
import { useBoardView } from './Board.hooks';
import type { BoardProps } from './Board.types';

const EMPTY_TEXT: Record<string, string> = {
  backlog: 'Add a task to begin',
  in_progress: 'Nothing running',
  waiting_approval: 'Nothing awaiting approval',
  done: 'No verified tasks yet',
  failed: 'No failures',
};

const CARD_STYLES: [value: CardStyle, label: string][] = [
  ['glow', 'Glow'],
  ['flat', 'Flat'],
  ['outline', 'Outline'],
];

/** The Kanban board: a header (title + count chip, project path/branch subtitle,
 *  search, the M2 concurrency slider + Auto Mode toggle, and the card-style
 *  switcher), over the five columns. Search and card-style live in the board's
 *  view hook; the M2 controls are visible-but-disabled and roadmap-badged. */
export function Board({
  tasks,
  projectPath,
  projectBranch,
  concurrency,
  selectedId,
  logCounts,
  onSelect,
  onNewTask,
  onRun,
  onCancel,
  onDelete,
  onClearColumn,
}: BoardProps) {
  const { search, setSearch, cardStyle, setCardStyle, columns, blockedIds } =
    useBoardView(tasks);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-3.5 border-b border-border px-[22px] pb-3.5 pt-[18px]">
        <div className="flex flex-wrap items-start gap-x-5 gap-y-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h1 className="text-[21px] font-semibold tracking-tight">Kanban Board</h1>
              <span className="rounded-md border border-border bg-white/[0.04] px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                {tasks.length} tasks
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2 font-mono text-[11.5px] text-muted-foreground">
              <span className="truncate">{projectPath}</span>
              {projectBranch !== null && (
                <>
                  <span className="opacity-40">·</span>
                  <BranchIcon size={11} />
                  <span>{projectBranch}</span>
                </>
              )}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2.5">
            <div
              title="Max parallel runs (M2)"
              className="relative flex items-center gap-2.5 rounded-[9px] border border-border bg-white/[0.02] px-3 py-1.5 opacity-60"
            >
              <AgentsIcon size={15} className="text-muted-foreground" />
              <input
                type="range"
                min={1}
                max={6}
                value={concurrency}
                disabled
                readOnly
                className="w-[84px] accent-primary"
              />
              <span className="w-2.5 font-mono text-xs font-semibold">{concurrency}</span>
              <span className="absolute -top-1.5 right-2 rounded bg-primary/[0.18] px-1 font-mono text-[8px] tracking-[0.05em] text-primary">
                M2
              </span>
            </div>
            <button
              type="button"
              disabled
              title="Auto Mode arrives in M2"
              className="relative flex items-center gap-2.5 rounded-[9px] border border-border bg-white/[0.02] px-3.5 py-1.5 text-[12.5px] font-semibold text-foreground opacity-60"
            >
              <BoltIcon size={14} className="text-muted-foreground" />
              <span>Auto Mode</span>
              <span className="relative h-[17px] w-[30px] rounded-full bg-white/[0.12]">
                <span className="absolute left-0.5 top-0.5 h-[13px] w-[13px] rounded-full bg-white" />
              </span>
              <span className="absolute -top-1.5 right-2 rounded bg-primary/[0.18] px-1 font-mono text-[8px] text-primary">
                M2
              </span>
            </button>
            <button
              type="button"
              onClick={onNewTask}
              className="flex items-center gap-1.5 rounded-[9px] bg-primary px-3.5 py-2 text-[12.5px] font-semibold text-primary-foreground transition-[filter] hover:brightness-110"
            >
              <PlusIcon size={14} />
              New task
              <Kbd>N</Kbd>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-[220px] max-w-[420px] flex-1 items-center gap-2.5 rounded-[9px] border border-border bg-white/[0.02] px-3 py-2">
            <SearchIcon size={15} className="text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks by keyword…"
              className="flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground/70">
              Cards
            </span>
            <div className="flex gap-0.5 rounded-[9px] border border-border bg-black/25 p-0.5">
              {CARD_STYLES.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setCardStyle(value)}
                  title={`${label} cards`}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    cardStyle === value
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-1 gap-3.5 overflow-x-auto overflow-y-hidden px-[22px] py-4">
        {columns.map(({ def, tasks: colTasks }) => (
          <Column
            key={def.key}
            title={def.title}
            tasks={colTasks}
            dotColor={def.dotColor}
            badge={def.badge}
            clearable={def.clearable}
            selectedId={selectedId}
            cardStyle={cardStyle}
            blockedIds={blockedIds}
            logCounts={logCounts}
            emptyText={search.trim() !== '' ? 'No matches' : EMPTY_TEXT[def.key]}
            onSelect={onSelect}
            onRun={onRun}
            onCancel={onCancel}
            onDelete={onDelete}
            onClear={() => onClearColumn(def.statuses)}
          />
        ))}
      </div>
    </div>
  );
}
