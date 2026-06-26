import type { ReactNode } from 'react';
import {
  BuildIcon,
  Button,
  CloseIcon,
  IconButton,
  Markdown,
  Modal,
  MoveIcon,
} from '@/components/ui';
import { DIMENSION_META, GRADE_META } from '../scorecard.constants';
import type { ScorecardReadingView } from '../scorecard.types';
import type { ReadingDetailPanelProps } from './ReadingDetailPanel.types';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        {title}
      </h4>
      {children}
    </section>
  );
}

function locationLabel(
  loc: ScorecardReadingView['location'],
): string | null {
  if (loc === null) return null;
  if (loc.startLine !== null) {
    const range =
      loc.endLine !== null && loc.endLine !== loc.startLine
        ? `${loc.startLine}-${loc.endLine}`
        : String(loc.startLine);
    return `${loc.file}:${range}${loc.symbol !== null ? ` · ${loc.symbol}` : ''}`;
  }
  return loc.file;
}

/** The reading detail sheet: the big grade badge, the graded summary, what would
 *  raise it, the grounded evidence, and the single "Harden this" action that mints a
 *  Build task running the dimension's audit slash-command. No dismiss/restore. */
export function ReadingDetailPanel({
  reading,
  pending,
  onClose,
  onHarden,
  onGotoBoard,
}: ReadingDetailPanelProps) {
  const Meta = DIMENSION_META[reading.dimension];
  const Icon = Meta.icon;
  const grade = GRADE_META[reading.grade];
  const loc = locationLabel(reading.location);

  return (
    <Modal
      label={`${Meta.label}: ${reading.grade}`}
      onClose={onClose}
      overlayClassName="fixed inset-0 z-20 flex justify-end bg-black/60 backdrop-blur-sm"
      panelClassName="flex h-full w-full max-w-lg flex-col overflow-hidden border-l border-border bg-popover shadow-2xl"
      panelStyle={{ animation: 'nc-sheet-in .28s cubic-bezier(.22,1,.36,1)' }}
    >
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <span
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] border font-mono text-[24px] font-bold leading-none ${grade.chip} ${grade.tone}`}
        >
          {grade.label}
        </span>
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              <Icon size={11} />
              {Meta.label}
            </span>
            {reading.confidence !== null && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {Math.round(reading.confidence * 100)}% confidence
              </span>
            )}
          </div>
          <h2 className="text-[15px] font-semibold leading-snug text-foreground">
            {reading.title}
          </h2>
        </div>
        <IconButton label="Close" onClick={onClose}>
          <CloseIcon size={16} />
        </IconButton>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
        <Section title="Assessment">
          <Markdown>{reading.summary}</Markdown>
        </Section>

        {loc !== null && (
          <Section title="Location">
            <code className="break-all rounded-md border border-border bg-white/[0.03] px-2 py-1 font-mono text-[11.5px] text-foreground">
              {loc}
            </code>
          </Section>
        )}

        {reading.rationale !== null && (
          <Section title="To raise the grade">
            <Markdown>{reading.rationale}</Markdown>
          </Section>
        )}

        {reading.suggestion !== null && (
          <Section title="Suggested action">
            <Markdown>{reading.suggestion}</Markdown>
          </Section>
        )}

        {reading.findings.length > 0 && (
          <Section title="Evidence">
            <ul className="flex flex-col gap-1.5">
              {reading.findings.map((ev, i) => (
                <li
                  key={`${ev.detail}-${i}`}
                  className="text-[12.5px] leading-relaxed text-muted-foreground"
                >
                  {ev.detail}
                  {ev.location !== null && (
                    <code className="ml-1.5 font-mono text-[11px] text-muted-foreground/70">
                      {ev.location.file}
                      {ev.location.startLine !== null
                        ? `:${ev.location.startLine}`
                        : ''}
                    </code>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {reading.affectedFiles.length > 0 && (
          <Section title="Affected files">
            <ul className="flex flex-col gap-1">
              {reading.affectedFiles.map((f) => (
                <li key={f}>
                  <code className="font-mono text-[11.5px] text-muted-foreground">
                    {f}
                  </code>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {reading.tags.length > 0 && (
          <Section title="Tags">
            <div className="flex flex-wrap gap-1.5">
              {reading.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-md border border-border bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
          </Section>
        )}
      </div>

      {/* Footer action — the single "Harden this" button (or go-to-task once minted). */}
      <div className="flex items-center gap-2 border-t border-border px-5 py-4">
        {reading.status === 'converted' ? (
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => onGotoBoard?.()}
          >
            <MoveIcon size={15} />
            Go to task
          </Button>
        ) : (
          <Button disabled={pending} onClick={() => onHarden(reading.id)}>
            <BuildIcon size={15} />
            Harden this
          </Button>
        )}
      </div>
    </Modal>
  );
}
