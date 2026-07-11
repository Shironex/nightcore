import type { Meta, StoryObj } from '@storybook/react-vite';

import type { ConventionDriftVM, RuleCoverageGapVM } from '../harness.types';
import { RuleCoverageGaps } from './RuleCoverageGaps';

function gap(over: Partial<RuleCoverageGapVM> = {}): RuleCoverageGapVM {
  const fp = over.conventionFingerprint ?? over.fingerprint ?? 'fp';
  return {
    id: `coverage-${fp}`,
    conventionFingerprint: fp,
    category: 'imports-boundaries',
    title: 'A convention',
    status: 'unenforced',
    enforcedBy: [],
    documentedIn: [],
    suggestedArtifactKind: null,
    ...over,
    fingerprint: fp,
  };
}

function drift(over: Partial<ConventionDriftVM> = {}): ConventionDriftVM {
  const fp = over.conventionFingerprint ?? over.fingerprint ?? 'fp';
  return {
    id: `drift-${fp}`,
    conventionFingerprint: fp,
    category: 'imports-boundaries',
    title: 'A convention',
    status: 'clean',
    method: 'lint-meta: a-rule',
    sitesMatched: 0,
    sitesChecked: 0,
    checkName: 'a-rule',
    errorReason: null,
    ...over,
    fingerprint: fp,
  };
}

const MIXED_GAPS: RuleCoverageGapVM[] = [
  gap({
    conventionFingerprint: 'fp1',
    title: 'Components follow strict folder-per-component',
    status: 'enforced',
    enforcedBy: ['nightcore/component-folder-structure'],
  }),
  gap({
    conventionFingerprint: 'fp2',
    title: 'Error handling goes through the shared taxonomy',
    status: 'documented-only',
    documentedIn: ['Errors go through the taxonomy.'],
  }),
  gap({
    conventionFingerprint: 'fp3',
    title: 'No reaching past a feature public barrel',
    status: 'unenforced',
    suggestedArtifactKind: 'eslint-rule',
  }),
];

const meta = {
  title: 'Harness/RuleCoverageGaps',
  component: RuleCoverageGaps,
  args: {
    gaps: MIXED_GAPS,
    // fp1 drifted (method + counts), fp3 clean (method + counts); fp2 has no armed
    // check → the UI derives `uncheckable`.
    drift: [
      drift({
        conventionFingerprint: 'fp1',
        title: 'Components follow strict folder-per-component',
        status: 'drifted',
        method: 'lint-meta: folder-per-component',
        sitesMatched: 3,
        sitesChecked: 42,
        checkName: 'folder-per-component',
      }),
      drift({
        conventionFingerprint: 'fp3',
        title: 'No reaching past a feature public barrel',
        status: 'clean',
        method: 'shell: rg -c cross-feature-import',
        sitesMatched: 0,
        sitesChecked: 18,
        checkName: 'no-cross-feature-imports',
      }),
    ],
  },
} satisfies Meta<typeof RuleCoverageGaps>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Coverage + measured drift joined by fingerprint: a drifted rule, a clean rule
 *  (both WITH method + counts), and a documented-only convention derived
 *  `uncheckable` (no armed check). */
export const MixedCoverage: Story = {};

/** Every convention has an enforcing rule; no EnforceRun yet → drift not measured. */
export const AllEnforced: Story = {
  args: {
    gaps: [
      gap({
        conventionFingerprint: 'e1',
        title: 'Folder-per-component',
        status: 'enforced',
        enforcedBy: ['nightcore/component-folder-structure'],
      }),
    ],
    drift: [],
  },
};

/** Coverage present but NO EnforceRun has run — the honest "not measured yet" state
 *  (no drift chips, no fake "clean"). */
export const DriftNotMeasured: Story = {
  args: { gaps: MIXED_GAPS, drift: [] },
};

/** An armed check that ran but whose output could not be parsed into counts →
 *  `errored` with its reason (never silently "clean"). */
export const DriftErrored: Story = {
  args: {
    gaps: [
      gap({
        conventionFingerprint: 'x1',
        title: 'Public API stays additive',
        status: 'enforced',
        enforcedBy: ['api-extractor'],
      }),
    ],
    drift: [
      drift({
        conventionFingerprint: 'x1',
        title: 'Public API stays additive',
        status: 'errored',
        method: 'shell: api-extractor run',
        sitesMatched: 0,
        sitesChecked: 0,
        errorReason: 'api-extractor exited 2 (config not found)',
      }),
    ],
  },
};

/** A run with no coverage renders nothing. */
export const Empty: Story = { args: { gaps: [], drift: [] } };
