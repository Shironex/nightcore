import type { Meta, StoryObj } from '@storybook/react-vite';

import type { WorktreeDiff } from '@/lib/bridge';

import { FixDiffPreview } from './FixDiffPreview';

const DIFF: WorktreeDiff = {
  files: [
    { path: 'src/auth.ts', status: 'modified', additions: 4, deletions: 2 },
    { path: 'src/new.ts', status: 'added', additions: 12, deletions: 0 },
  ],
  summary: '2 files changed, +16 -2',
  additions: 16,
  deletions: 2,
};

const PATCH = `diff --git a/src/auth.ts b/src/auth.ts
@@ -1,3 +1,5 @@
 export function login() {
-  log(token);
+  log('[redacted]');
 }
`;

const meta = {
  title: 'PrReview/FixDiffPreview',
  component: FixDiffPreview,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="w-[560px]">
        <Story />
      </div>
    ),
  ],
  args: {
    fixId: 'prfix-1',
    fetchDiff: async () => DIFF,
    fetchPatch: async () => PATCH,
  },
} satisfies Meta<typeof FixDiffPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The populated diff: a summary line over the changed-file rows (expandable). */
export const Populated: Story = {};

/** A fix commit with no file changes (also the non-Tauri fetch result). */
export const Empty: Story = {
  args: {
    fetchDiff: async () => ({ files: [], summary: '', additions: 0, deletions: 0 }),
  },
};

/** The diff fetch failed — a quiet, non-blocking note (the push button stays). */
export const LoadFailed: Story = {
  args: {
    fetchDiff: async () => {
      throw new Error('pr-fix registry unavailable');
    },
  },
};
