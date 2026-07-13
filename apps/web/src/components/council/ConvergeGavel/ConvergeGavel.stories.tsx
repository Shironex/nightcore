import type { Meta, StoryObj } from '@storybook/react-vite';

import type { ConvergePosition } from '../council.types';
import { ConvergeGavel } from './ConvergeGavel';

const POSITIONS: ConvergePosition[] = [
  {
    seatId: 'proposer-opus',
    role: 'proposer',
    content: 'Feature-flag the store, dual-write with idempotency keys, then cut over.',
  },
  {
    seatId: 'proposer-sonnet',
    role: 'proposer',
    content: 'Big-bang migrate in a maintenance window — simpler, but no live rollback.',
  },
  {
    seatId: 'critic-opus',
    role: 'critic',
    content: 'Neither is safe without a rehearsed backfill + rollback. Prefer the flag.',
  },
];

const meta = {
  title: 'Council/ConvergeGavel',
  component: ConvergeGavel,
  parameters: { layout: 'fullscreen' },
  args: {
    positions: POSITIONS,
    // The story dispatch resolves immediately; the real one routes through the Conductor.
    onResolve: async () => {},
  },
} satisfies Meta<typeof ConvergeGavel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Awaiting: Story = {};

export const NoPositionsYet: Story = { args: { positions: [] } };

export const Resolved: Story = {
  args: {
    resolved: true,
    verdict: 'Human verdict — ACCEPT: adopted seat "proposer-opus" (proposer). Reason: safest rollback.',
  },
};
