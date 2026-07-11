import type { ComponentType } from 'react';

import {
  AgentsIcon,
  BookIcon,
  ChecksIcon,
  DecomposeIcon,
  FolderIcon,
  LayersIcon,
  RefactorIcon,
  TagIcon,
} from '@/components/ui';
import type {
  ArtifactKind,
  ConventionCategory,
  ConventionDriftStatus,
  ConventionKind,
  CoverageStatus,
  HarnessProposalKind,
} from '@/lib/bridge';



/** Every convention lens, in display order. */
export const ALL_CATEGORIES: ConventionCategory[] = [
  'architecture',
  'folder-structure',
  'naming',
  'imports-boundaries',
  'design-decisions',
  'tooling-lint',
  'testing',
  'agent-context',
];

interface CategoryMeta {
  label: string;
  /** Accepts `className` so it can be tinted at the call site (e.g. RunProgress
   *  rows render it `text-muted-foreground`). */
  icon: ComponentType<{ size?: number; className?: string }>;
}

/** Per-lens label + glyph for tabs and cards. */
export const CATEGORY_META: Record<ConventionCategory, CategoryMeta> = {
  architecture: { label: 'Architecture', icon: LayersIcon },
  'folder-structure': { label: 'Folder Structure', icon: FolderIcon },
  naming: { label: 'Naming', icon: TagIcon },
  'imports-boundaries': { label: 'Imports & Boundaries', icon: DecomposeIcon },
  'design-decisions': { label: 'Design Decisions', icon: BookIcon },
  'tooling-lint': { label: 'Tooling & Lint', icon: RefactorIcon },
  testing: { label: 'Testing', icon: ChecksIcon },
  'agent-context': { label: 'Agent Context', icon: AgentsIcon },
};

interface KindMeta {
  label: string;
  /** Tailwind text tone for the badge. */
  tone: string;
  /** Tailwind bg/border tone for the badge chip. */
  chip: string;
}

/** Whether a finding records an existing convention (codify + enforce it) or a
 *  gap against best practice (propose adopting it). */
export const KIND_META: Record<ConventionKind, KindMeta> = {
  convention: {
    label: 'Convention',
    tone: 'text-primary',
    chip: 'bg-primary/[0.1] border-primary/40',
  },
  gap: {
    label: 'Gap',
    tone: 'text-warning',
    chip: 'bg-warning/[0.12] border-warning/40',
  },
};

/** The severity scale (order, ranking, badge palette) is shared across every
 *  grounded-finding surface — re-exported from `lib/` so it can't drift per
 *  feature (`no-cross-feature-imports` forbids reaching into a sibling feature,
 *  so `lib/` is the one import-legal shared home). See {@link ../../lib/severity}. */
export { SEVERITY_META, SEVERITY_ORDER, severityRankValue } from '@/lib/severity';

interface CoverageStatusMeta {
  label: string;
  /** Tailwind text tone for the badge. */
  tone: string;
  /** Tailwind bg/border tone for the badge chip. */
  chip: string;
  /** One-line description for the panel legend / row hover. */
  hint: string;
}

/** ENFORCE-lite coverage status palette + copy. `enforced` reads as the green
 *  "has teeth" state; `documented-only` is the amber "claimed but unenforced"
 *  (the agent-contract-parity insight inverted); `unenforced` is the muted gap.
 *  Copy anchors on COVERAGE, not conformance — never "followed". */
export const COVERAGE_STATUS_META: Record<CoverageStatus, CoverageStatusMeta> = {
  enforced: {
    label: 'Enforced',
    tone: 'text-success',
    chip: 'bg-success/[0.12] border-success/40',
    hint: 'A lint/meta rule (or armed gauntlet check) covers this convention.',
  },
  'documented-only': {
    label: 'Documented only',
    tone: 'text-warning',
    chip: 'bg-warning/[0.12] border-warning/40',
    hint: 'An agent doc claims it, but no rule enforces it — a guardrail without teeth.',
  },
  unenforced: {
    label: 'Unenforced',
    tone: 'text-muted-foreground',
    chip: 'bg-white/[0.05] border-border',
    hint: 'Neither a rule nor an agent doc covers this convention.',
  },
};

interface DriftStatusMeta {
  label: string;
  /** Tailwind text tone for the badge. */
  tone: string;
  /** Tailwind bg/border tone for the badge chip. */
  chip: string;
  /** One-line description for the row hover. */
  hint: string;
}

/** Drift-v1 (T15) conformance status palette + copy — the MEASURED sibling of
 *  {@link COVERAGE_STATUS_META}. `clean` reads as the green "followed at every
 *  checked site" state (always WITH counts); `drifted` is the red "N sites violate";
 *  `errored` is the amber "ran but couldn't be counted"; `uncheckable` is the muted
 *  honest "no armed check measures this". Never a bare "followed"/"clean" — the row
 *  always shows the method + site counts alongside a `clean`/`drifted` chip. */
export const DRIFT_STATUS_META: Record<ConventionDriftStatus, DriftStatusMeta> = {
  clean: {
    label: 'Clean',
    tone: 'text-success',
    chip: 'bg-success/[0.12] border-success/40',
    hint: 'An armed check ran and found no violating sites (shown with its method + counts).',
  },
  drifted: {
    label: 'Drifted',
    tone: 'text-destructive',
    chip: 'bg-destructive/[0.12] border-destructive/40',
    hint: 'An armed check found sites that violate this convention.',
  },
  uncheckable: {
    label: 'Uncheckable',
    tone: 'text-muted-foreground',
    chip: 'bg-white/[0.05] border-border',
    hint: 'No armed check covers this convention, so its conformance is unmeasured — not "clean".',
  },
  errored: {
    label: 'Errored',
    tone: 'text-warning',
    chip: 'bg-warning/[0.12] border-warning/40',
    hint: 'The armed check could not run, or its output could not be parsed into site counts.',
  },
};

/** Per-artifact-kind label for the proposal list + detail panel. */
export const ARTIFACT_KIND_META: Record<ArtifactKind, { label: string }> = {
  'lint-meta-rule': { label: 'lint-meta rule' },
  'eslint-rule': { label: 'ESLint rule' },
  'eslint-plugin-file': { label: 'ESLint plugin file' },
  'eslint-config': { label: 'ESLint config' },
  'agent-contract': { label: 'Agent contract' },
  'custom-lint-plugin': { label: 'Custom lint plugin' },
  'tool-config': { label: 'Tool config' },
};

/** eslint-runnable artifact kinds. Arming one wires the project's Structure-Lock
 *  gauntlet to actually execute the generated plugin — otherwise an applied plugin sits
 *  inert (never loaded by the user's own eslint config). Docs and lint-meta rules are
 *  not eslint-runnable, so they're excluded. */
const ESLINT_ARMABLE_KINDS: ReadonlySet<ArtifactKind> = new Set<ArtifactKind>([
  'eslint-rule',
  'eslint-plugin-file',
  'eslint-config',
  'custom-lint-plugin',
]);

/** Whether an artifact's kind can be armed as an ESLint gauntlet check (module #2 /
 *  inert-plugin fix). Combine with an `applied` status check at the call site. */
export function isEslintArmableKind(kind: ArtifactKind): boolean {
  return ESLINT_ARMABLE_KINDS.has(kind);
}

/** Per-proposal-kind label + one-line hint for the task-proposal list. `apply-artifacts`
 *  bundles safe file writes onto the hardened apply.rs path; `agent-task` becomes a
 *  worktree Build task an agent performs and a human reviews as a diff. */
export const PROPOSAL_KIND_META: Record<
  HarnessProposalKind,
  { label: string; hint: string }
> = {
  'apply-artifacts': {
    label: 'Apply artifacts',
    hint: 'writes the bundled files to disk',
  },
  'agent-task': {
    label: 'Agent task',
    hint: 'a worktree Build task, reviewed as a diff',
  },
};

/** How `apply` writes the artifact, as the confirm dialog states it. */
export const WRITE_MODE_META: Record<string, { label: string; hint: string }> = {
  create: {
    label: 'create',
    hint: 'new file — refuses to overwrite an existing one',
  },
  'merge-section': {
    label: 'merge-section',
    hint: 'managed block — inserted or replaced, creating the file if absent',
  },
};


