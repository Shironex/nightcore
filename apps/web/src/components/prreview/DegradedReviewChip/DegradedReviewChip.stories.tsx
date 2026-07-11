import type { Meta, StoryObj } from '@storybook/react-vite';

import { DegradedReviewChip } from './DegradedReviewChip';

const meta = {
  title: 'PrReview/DegradedReviewChip',
  component: DegradedReviewChip,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="w-[560px]">
        <Story />
      </div>
    ),
  ],
  args: { lenses: ['security'] },
} satisfies Meta<typeof DegradedReviewChip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One lens errored — singular copy. */
export const OneLens: Story = {};

/** Several lenses errored — plural copy, all named. */
export const ManyLenses: Story = { args: { lenses: ['security', 'logic', 'tests'] } };

/** No lens errored — the chip renders nothing (self-hides). */
export const Healthy: Story = { args: { lenses: [] } };
