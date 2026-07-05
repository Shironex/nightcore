/** The validation launcher for the selected issue: a model + reasoning-effort picker
 *  and a Validate / Re-validate button when idle, and the shared RunProgress panel +
 *  a Cancel control while a read-only validation session is in flight. One validation
 *  runs at a time (single-issue; no batch "validate all"). */
import {
  Button,
  ModelEffortPicker,
  RunProgress,
  type RunProgressCategory,
  SearchIcon,
  SparkIcon,
  StopIcon,
} from '@/components/ui';

import type { ValidateControlsProps } from './ValidateControls.types';

/** The single "step" the read-only validation session runs — reuses RunProgress
 *  (the house run panel) so the live cost / token / elapsed readout matches the
 *  scan siblings, even though there is only one pass. */
const VALIDATE_STEPS: RunProgressCategory[] = [
  { key: 'validate', label: 'Validating against the codebase', icon: SearchIcon },
];

/** The idle picker + launch button, or the running panel + cancel. */
export function ValidateControls({
  stream,
  model,
  effort,
  onChangeModel,
  onChangeEffort,
  canValidate,
  isStarting,
  hasVerdict,
  startError,
  onValidate,
  onCancel,
}: ValidateControlsProps) {
  const running = stream.status === 'running' || isStarting;

  if (running) {
    return (
      <div className="flex flex-col gap-4">
        <RunProgress
          status="running"
          categories={VALIDATE_STEPS}
          categoryState={{ validate: 'running' }}
          findingCounts={{}}
          unitLabel="step"
          costUsd={stream.costUsd}
          usage={stream.usage}
          durationMs={stream.durationMs}
        />
        {stream.progressMessage !== null && (
          <p
            role="status"
            aria-live="polite"
            className="text-[12.5px] text-muted-foreground"
          >
            {stream.progressMessage}
          </p>
        )}
        <div className="flex justify-end">
          <Button variant="danger" onClick={onCancel}>
            <StopIcon size={15} />
            Cancel validation
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-2 text-[12.5px] text-muted-foreground">
          Validate this issue against the actual codebase with a read-only session — it
          classifies the issue, grounds the related files, and proposes a plan.
        </p>
        <ModelEffortPicker
          model={model}
          effort={effort}
          onChangeModel={onChangeModel}
          onChangeEffort={onChangeEffort}
          disabled={!canValidate}
        />
      </div>

      {startError !== null && (
        <p className="rounded-[10px] border border-destructive/40 bg-destructive/[0.08] px-3 py-2 text-[12.5px] text-destructive">
          {startError}
        </p>
      )}

      <div className="flex justify-end">
        <Button disabled={!canValidate} onClick={onValidate}>
          <SparkIcon size={15} />
          {hasVerdict ? 'Re-validate' : 'Validate against the codebase'}
        </Button>
      </div>
    </div>
  );
}
