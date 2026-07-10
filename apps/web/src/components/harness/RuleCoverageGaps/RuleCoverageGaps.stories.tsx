import type { Meta, StoryObj } from '@storybook/react-vite';

import type { RuleCoverageGapVM } from '../harness.types';
import { RuleCoverageGaps } from './RuleCoverageGaps';

function gap(over: Partial<RuleCoverageGapVM> = {}): RuleCoverageGapVM {
  return {
    id: 'coverage-fp',
    conventionFingerprint: 'fp',
    category: 'imports-boundaries',
    title: 'A convention',
    status: 'unenforced',
    enforcedBy: [],
    documentedIn: [],
    suggestedArtifactKind: null,
    fingerprint: 'fp',
    ...over,
  };
}

const meta = {
  title: 'Harness/RuleCoverageGaps',
  component: RuleCoverageGaps,
  args: {
    gaps: [
      gap({
        id: 'g1',
        fingerprint: 'fp1',
        title: 'Components follow strict folder-per-component',
        status: 'enforced',
        enforcedBy: ['nightcore/component-folder-structure'],
      }),
      gap({
        id: 'g2',
        fingerprint: 'fp2',
        title: 'Error handling goes through the shared taxonomy',
        status: 'documented-only',
        documentedIn: ['Errors go through the taxonomy.'],
      }),
      gap({
        id: 'g3',
        fingerprint: 'fp3',
        title: 'No reaching past a feature public barrel',
        status: 'unenforced',
        suggestedArtifactKind: 'eslint-rule',
      }),
    ],
  },
} satisfies Meta<typeof RuleCoverageGaps>;

export default meta;
type Story = StoryObj<typeof meta>;

/** All three coverage statuses, actionable (unenforced) first. */
export const MixedCoverage: Story = {};

/** Every convention has an enforcing rule. */
export const AllEnforced: Story = {
  args: {
    gaps: [
      gap({
        id: 'e1',
        fingerprint: 'e1',
        title: 'Folder-per-component',
        status: 'enforced',
        enforcedBy: ['nightcore/component-folder-structure'],
      }),
    ],
  },
};

/** A run with no coverage renders nothing. */
export const Empty: Story = { args: { gaps: [] } };
