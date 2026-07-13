import type { Meta, StoryObj } from '@storybook/react-vite';

import type { ReplyRound } from '../reply-diff';
import { ReplyDiff } from './ReplyDiff';

const ROUNDS: ReplyRound[] = [
  {
    broadcastId: 'bc-0',
    stage: 'propose',
    label: 'Propose',
    isFinal: false,
    diverged: true,
    columns: [
      {
        seatId: 'proposer-opus',
        role: 'proposer',
        seq: 1,
        content: '**Feature-flag** the new store, dual-write, then cut over once parity holds.',
      },
      {
        seatId: 'proposer-sonnet',
        role: 'proposer',
        seq: 2,
        content: '**Big-bang** migrate in a single transaction during a maintenance window.',
      },
      {
        seatId: 'critic-opus',
        role: 'critic',
        seq: 3,
        content: 'Both risk data loss without a **verified backfill + rollback** rehearsal first.',
      },
    ],
  },
  {
    broadcastId: 'debate-r1',
    stage: 'debate',
    label: 'Debate · round 1',
    isFinal: true,
    diverged: true,
    columns: [
      {
        seatId: 'proposer-opus',
        role: 'proposer',
        seq: 6,
        content: 'Concede the backfill rehearsal — keep the flag; it makes rollback a config flip.',
      },
      {
        seatId: 'proposer-sonnet',
        role: 'proposer',
        seq: 7,
        content: 'Drop big-bang. The flag path is strictly safer with a small latency cost.',
      },
      {
        seatId: 'critic-opus',
        role: 'critic',
        seq: 8,
        content: 'Agree on the flag IF the dual-write is idempotency-keyed. Otherwise a retry doubles rows.',
      },
    ],
  },
];

const meta = {
  title: 'Council/ReplyDiff',
  component: ReplyDiff,
  parameters: { layout: 'fullscreen' },
  args: { rounds: ROUNDS },
} satisfies Meta<typeof ReplyDiff>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwoRounds: Story = {};

export const Aligned: Story = {
  args: {
    rounds: [
      {
        broadcastId: 'bc-0',
        stage: 'propose',
        label: 'Propose',
        isFinal: true,
        diverged: false,
        columns: [
          { seatId: 'a', role: 'proposer', seq: 1, content: 'Use the flag path.' },
          { seatId: 'b', role: 'critic', seq: 2, content: 'Use the flag path.' },
        ],
      },
    ],
  },
};

export const Empty: Story = { args: { rounds: [] } };
