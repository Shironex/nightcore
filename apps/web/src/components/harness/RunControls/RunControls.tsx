import { Button, ModelEffortPicker, StopIcon, VerifiedIcon } from '@/components/ui';
import { ALL_CATEGORIES, CATEGORY_META } from '../harness.constants';
import { useRunControls } from './RunControls.hooks';
import type { RunControlsProps } from './RunControls.types';

const CHIP =
  'rounded-[10px] border px-3 py-1.5 text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

function chipClass(selected: boolean): string {
  return `${CHIP} ${
    selected
      ? 'border-primary/60 bg-primary/[0.1] text-foreground'
      : 'border-border bg-white/[0.02] text-muted-foreground hover:border-white/20'
  }`;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** The run configuration bar: convention lenses, model/effort, and the
 *  Scan/Cancel action plus a live cost/token/duration readout. Harness always
 *  scans the whole repo, so there is no scope picker. */
export function RunControls(props: RunControlsProps) {
  const { stream, isStarting, onScan, onCancel } = props;
  const {
    running,
    model,
    setModel,
    effort,
    setEffort,
    selected,
    toggle,
    selectAll,
    selectNone,
    orderedSelected,
    canScan,
  } = useRunControls(props);

  return (
    <div className="flex flex-col gap-4 border-b border-border bg-white/[0.015] px-6 py-5">
      <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
        {/* Model + effort (reuses the shared picker for parity) */}
        <div className="min-w-[260px] flex-1">
          <ModelEffortPicker
            model={model}
            effort={effort}
            onChangeModel={setModel}
            onChangeEffort={setEffort}
            disabled={running}
          />
        </div>
      </div>

      {/* Convention lenses */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            Lenses ({orderedSelected.length}/{ALL_CATEGORIES.length})
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={running}
              onClick={selectAll}
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              All
            </button>
            <button
              type="button"
              disabled={running}
              onClick={selectNone}
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              None
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {ALL_CATEGORIES.map((c) => {
            const Meta = CATEGORY_META[c];
            const Icon = Meta.icon;
            const on = selected.has(c);
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                disabled={running}
                onClick={() => toggle(c)}
                className={`inline-flex items-center gap-1.5 ${chipClass(on)}`}
              >
                <Icon size={13} />
                {Meta.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Action + live readout */}
      <div className="flex flex-wrap items-center gap-3">
        {running ? (
          <Button variant="danger" onClick={onCancel}>
            <StopIcon size={15} />
            Cancel scan
          </Button>
        ) : (
          <Button
            disabled={!canScan}
            onClick={() => onScan(orderedSelected, model, effort)}
          >
            <VerifiedIcon size={15} />
            {isStarting ? 'Starting…' : 'Scan'}
          </Button>
        )}

        {(running || stream.status === 'completed') && (
          <div className="flex items-center gap-4 font-mono text-[11px] text-muted-foreground">
            <span>${stream.costUsd.toFixed(3)}</span>
            <span>
              {formatTokens(stream.usage.inputTokens + stream.usage.outputTokens)}{' '}
              tok
            </span>
            {stream.durationMs > 0 && (
              <span>{(stream.durationMs / 1000).toFixed(1)}s</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
