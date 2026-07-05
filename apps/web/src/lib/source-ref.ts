/** Parsing + labeling for a task's `sourceRef` provenance token — the
 *  `<feature>:<runId>:<itemId>` stamp minted (Rust-side) when a scan item
 *  (Insight finding, Scorecard reading, Harness convention/proposal) is
 *  converted into a board task. The prefix registry lives here once so the
 *  drawer's chip label and the board→scan navigation target can't drift. */

/** A parsed provenance token: which scan surface owns the item and what to
 *  preselect there. `kind` picks the view's selection channel — Harness
 *  distinguishes convention findings from task-shaped proposals; Issue Triage's
 *  `validation` is run-level (the whole validation IS the item). */
export interface ScanTarget {
  view: 'insight' | 'scorecard' | 'harness' | 'prreview' | 'issuetriage';
  kind: 'finding' | 'reading' | 'proposal' | 'validation';
  runId: string;
  itemId: string;
}

/** prefix → owning view + selection channel + human chip label (+ whether the
 *  token is run-level, i.e. minted WITHOUT an item segment). A scheme not in this
 *  registry renders no chip and navigates nowhere, so a future/legacy token degrades
 *  silently instead of breaking the drawer. */
const REGISTRY: Record<
  string,
  {
    view: ScanTarget['view'];
    kind: ScanTarget['kind'];
    label: string;
    /** True for a `<scheme>:<runId>` token with no item segment (the run IS the
     *  item). Item-level schemes require a third `<itemId>` segment. */
    runLevel?: boolean;
  }
> = {
  insight: { view: 'insight', kind: 'finding', label: 'Insight finding' },
  scorecard: { view: 'scorecard', kind: 'reading', label: 'Scorecard reading' },
  harness: { view: 'harness', kind: 'finding', label: 'Harness convention' },
  'harness-proposal': { view: 'harness', kind: 'proposal', label: 'Harness proposal' },
  // Keyed by the sourceRef PREFIX the Rust convert mints (`pr-review:<n>:<id>`),
  // not the AppView slug — the parser resolves by the token's first segment.
  'pr-review': { view: 'prreview', kind: 'finding', label: 'PR Review finding' },
  // SPELLING SPLIT (learned from `pr-review` vs `prreview`): the sourceRef KEY is
  // hyphenated (`issue-triage:<runId>` — what the Rust convert mints, see
  // `convert_issue_validation_to_task`), while the AppView it navigates to is NOT
  // (`issuetriage`). Keep both spellings consistent everywhere. This scheme is
  // run-level: the convert mints a 2-segment token (no itemId) because a validation
  // carries a single verdict, so the whole run IS the item.
  'issue-triage': {
    view: 'issuetriage',
    kind: 'validation',
    label: 'Issue validation',
    runLevel: true,
  },
};

/** Resolve a `sourceRef` to its human provenance label, or `null` for an
 *  unknown/absent token. */
export function sourceRefLabel(sourceRef: string | null): string | null {
  if (sourceRef === null) return null;
  return REGISTRY[sourceRef.split(':')[0] ?? '']?.label ?? null;
}

/** Parse a `sourceRef` into a navigable scan target, or `null` when the token
 *  is malformed or its scheme is unknown. Item ids may themselves contain
 *  colons; only the first two separators are structural. A run-level scheme
 *  (e.g. `issue-triage`) mints a 2-segment `<scheme>:<runId>` token — its
 *  `itemId` is empty (the run IS the item); every other scheme requires an
 *  `<itemId>` third segment. */
export function parseSourceRef(sourceRef: string): ScanTarget | null {
  const [prefix = '', runId = '', ...rest] = sourceRef.split(':');
  const itemId = rest.join(':');
  const entry = REGISTRY[prefix];
  if (entry === undefined || runId === '') return null;
  if (!entry.runLevel && itemId === '') return null;
  return { view: entry.view, kind: entry.kind, runId, itemId };
}
