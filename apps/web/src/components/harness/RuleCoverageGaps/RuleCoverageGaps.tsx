/** The Rule-Coverage-Gaps panel — the ENFORCE-lite signal rendered below the
 *  conventions grid in the Enforce destination. For each observed convention it
 *  shows whether an enforcing rule covers it (`enforced`), only an agent doc claims
 *  it (`documented-only`), or nothing does (`unenforced`), actionable gaps first.
 *
 *  COPY ANCHOR — "coverage, not conformance": Phase 1 checks whether a RULE EXISTS,
 *  never whether the convention is FOLLOWED at every site. Convention drift is the
 *  Next follow-up. The UI must not claim site-level adherence. */
import { COVERAGE_STATUS_META } from '../harness.constants';
import type { RuleCoverageGapVM } from '../harness.types';
import { useRuleCoverageGaps } from './RuleCoverageGaps.hooks';
import type { RuleCoverageGapsProps } from './RuleCoverageGaps.types';

/** One summary tally chip (e.g. "3 enforced"). */
function Tally({ label, count, tone }: { label: string; count: number; tone: string }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px]">
      <span className={`font-semibold tabular-nums ${tone}`}>{count}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

/** The coverage-status badge + a short detail line for one convention. */
function CoverageRow({ gap }: { gap: RuleCoverageGapVM }) {
  const meta = COVERAGE_STATUS_META[gap.status];
  const detail =
    gap.status === 'enforced' && gap.enforcedBy.length > 0
      ? `enforced by ${gap.enforcedBy.join(', ')}`
      : gap.status === 'documented-only' && gap.documentedIn.length > 0
        ? `documented: ${gap.documentedIn[0]}`
        : gap.suggestedArtifactKind !== null
          ? `propose a ${gap.suggestedArtifactKind} to enforce it`
          : 'no rule or agent-doc covers it';

  return (
    <div className="flex items-start gap-2.5 px-4 py-2.5">
      <span
        title={meta.hint}
        className={`mt-0.5 inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${meta.chip} ${meta.tone}`}
      >
        {meta.label}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] text-foreground">{gap.title}</p>
        <p className="truncate text-[11px] text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

/** The coverage panel. Renders nothing when the run carries no coverage (a
 *  pre-coverage run, or a scan with no conventions). */
export function RuleCoverageGaps({ gaps }: RuleCoverageGapsProps) {
  const { summary, ordered, hasCoverage } = useRuleCoverageGaps(gaps);
  if (!hasCoverage) return null;

  // The inventory line, kept a single string so it renders as one text node.
  const inventoryLine = `${summary.enforcingRuleCount} enforcing ${
    summary.enforcingRuleCount === 1 ? 'rule' : 'rules'
  } found`;

  return (
    <section
      aria-label="Rule coverage"
      className="flex max-h-[38vh] min-h-0 flex-col border-t border-border bg-white/[0.01]"
    >
      <header className="flex flex-col gap-1.5 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            Rule coverage
          </span>
          <Tally label="enforced" count={summary.enforced} tone={COVERAGE_STATUS_META.enforced.tone} />
          <Tally
            label="documented only"
            count={summary.documentedOnly}
            tone={COVERAGE_STATUS_META['documented-only'].tone}
          />
          <Tally
            label="unenforced"
            count={summary.unenforced}
            tone={COVERAGE_STATUS_META.unenforced.tone}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Coverage, not conformance — this checks whether a rule <em>exists</em> for each
          convention ({inventoryLine}), not whether it is followed at every site.
          Convention drift is next.
        </p>
      </header>
      <div className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto">
        {ordered.map((gap) => (
          <CoverageRow key={gap.id} gap={gap} />
        ))}
      </div>
    </section>
  );
}
