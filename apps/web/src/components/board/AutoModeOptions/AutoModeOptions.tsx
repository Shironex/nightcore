/** Settings content for the Auto Mode toolbar option — the auto-commit row shown
 *  inside the ToolbarOption settings popover. */
import type { AutoModeOptionsProps } from './AutoModeOptions.types';

export function AutoModeOptions({
  autoCommitOnVerified,
  onAutoCommitChange,
}: AutoModeOptionsProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={autoCommitOnVerified}
      aria-label="Auto-commit on verified"
      onClick={() => onAutoCommitChange(!autoCommitOnVerified)}
      className="flex w-full items-start gap-3 rounded-lg border border-border bg-white/[0.02] p-2.5 text-left transition-colors hover:border-white/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-semibold text-foreground">
          Auto-commit on verified
        </span>
        <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
          While Auto Mode runs, each task is committed automatically the moment
          it's verified — before the next one starts. In a shared (main)
          checkout, run one task at a time so per-task commits stay clean.
        </span>
      </span>
      <span
        aria-hidden
        className={`relative mt-0.5 h-[17px] w-[30px] shrink-0 rounded-full transition-colors ${
          autoCommitOnVerified ? 'bg-primary' : 'bg-white/[0.12]'
        }`}
      >
        <span
          className={`absolute top-0.5 h-[13px] w-[13px] rounded-full bg-white transition-transform ${
            autoCommitOnVerified ? 'left-[14px]' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  );
}
