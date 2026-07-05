/** The PR Review workspace panel (right side of the permanent two-panel layout):
 *  the selected PR's header (state/number/title/author/labels), the live STATUS
 *  BLOCK, the collapsible description, and the registry-driven REVIEW SECTION.
 *  The PR body is UNTRUSTED contributor markdown — rendered through the
 *  sanitizing `Markdown` primitive (marked + DOMPurify), never raw. */
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  Markdown,
} from '@/components/ui';

import { PrStatusBlock } from '../PrStatusBlock';
import { ReviewSection } from '../ReviewSection';
import {
  formatPrDate,
  labelChipStyle,
  useDescriptionCollapse,
} from './PrWorkspace.hooks';
import type { PrWorkspaceProps } from './PrWorkspace.types';

/** State-badge tones for the gh summary vocabulary (unknown → open styling —
 *  the list is open-only, so anything else only appears via a stale summary). */
function stateBadgeClass(state: string): string {
  if (state === 'MERGED') return 'border-primary/40 bg-primary/10 text-primary';
  if (state === 'CLOSED')
    return 'border-destructive/40 bg-destructive/10 text-destructive';
  return 'border-success/40 bg-success/10 text-success';
}

export function PrWorkspace({
  prNumber,
  pr,
  onOpenExternal,
  review,
  statusOverride,
}: PrWorkspaceProps) {
  const date = pr !== null ? formatPrDate(pr.createdAt) : null;
  const body = pr?.body ?? '';
  const description = useDescriptionCollapse(prNumber, body);

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-6 px-8 py-7">
      {/* Header: state + number + open-on-GitHub */}
      <div className="flex items-start justify-between gap-3">
        <span className="flex items-center gap-2">
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${stateBadgeClass(pr?.state ?? 'OPEN')}`}
          >
            {pr?.state === 'CLOSED'
              ? 'Closed'
              : pr?.state === 'MERGED'
                ? 'Merged'
                : 'Open'}
          </span>
          <span className="font-mono text-[13px] text-muted-foreground">
            #{prNumber}
          </span>
          {pr?.isDraft === true && (
            <span className="rounded-full border border-border px-1.5 py-px text-[10px] uppercase tracking-wide text-muted-foreground">
              Draft
            </span>
          )}
        </span>
        {pr !== null && pr.url.length > 0 && (
          <button
            type="button"
            onClick={() => onOpenExternal(pr.url)}
            aria-label="Open on GitHub"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
          >
            <ExternalLinkIcon size={16} />
          </button>
        )}
      </div>

      {/* Title */}
      <h2 className="text-2xl font-semibold leading-snug text-foreground">
        {pr !== null && pr.title.length > 0 ? pr.title : `Pull request #${prNumber}`}
      </h2>

      {/* Meta + labels */}
      {pr !== null && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <span>@{pr.author}</span>
            {date !== null && <span>· {date}</span>}
          </div>
          {pr.labels.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {pr.labels.map((label) => (
                <span
                  key={label.name}
                  style={labelChipStyle(label.color)}
                  className="rounded-full border border-border px-2 py-0.5 text-[11.5px] font-medium text-muted-foreground"
                >
                  {label.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {pr === null && (
        <p className="text-[12.5px] text-muted-foreground">
          This PR isn&apos;t in the open list — Nightcore will review it by number.
        </p>
      )}

      {/* Live GitHub status (fetch on selection + manual refresh, no polling). */}
      <PrStatusBlock prNumber={prNumber} override={statusOverride} />

      {/* Description (untrusted markdown → sanitized), collapsible when long. */}
      {pr !== null && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
              Description
            </span>
            <span className="text-[10.5px] text-muted-foreground/70">
              untrusted contributor content · sanitized
            </span>
          </div>
          {body.trim().length > 0 ? (
            <>
              <div
                className={
                  description.expanded
                    ? undefined
                    : 'relative max-h-[220px] overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]'
                }
              >
                <Markdown>{body}</Markdown>
              </div>
              {description.collapsible && (
                <button
                  type="button"
                  onClick={description.toggle}
                  aria-expanded={description.expanded}
                  className="inline-flex w-fit items-center gap-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  {description.expanded ? (
                    <ChevronDownIcon size={13} />
                  ) : (
                    <ChevronRightIcon size={13} />
                  )}
                  {description.expanded ? 'Show less' : 'Show full description'}
                </button>
              )}
            </>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              No description provided.
            </p>
          )}
        </div>
      )}

      {/* The per-PR review area, driven by the run registry. */}
      <ReviewSection {...review} />
    </div>
  );
}
