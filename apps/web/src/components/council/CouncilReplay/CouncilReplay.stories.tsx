import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import type { DebateTranscriptEntry } from '@/lib/bridge';

import { CouncilReplay } from './CouncilReplay';

/** A small finished-run transcript: frame → propose broadcast + two seat replies →
 *  human converge verdict. Enough to exercise the seat canvas, the team chat, and the
 *  terminal verdict line in a replay. */
export const REPLAY_FIXTURE: DebateTranscriptEntry[] = [
  {
    stage: 'frame',
    seatId: 'conductor',
    role: 'conductor',
    kind: 'note',
    seq: 0,
    content: 'Council framed. Objective: pick a caching strategy.',
    at: 1,
  },
  {
    stage: 'propose',
    seatId: 'conductor',
    role: 'conductor',
    kind: 'broadcast',
    seq: 1,
    content: 'Propose your best answer independently.',
    broadcastId: 'bc-1',
    at: 2,
  },
  {
    stage: 'propose',
    seatId: 'proposer-opus',
    role: 'proposer',
    kind: 'message',
    seq: 2,
    content: 'Write-through cache with a short TTL.',
    broadcastId: 'bc-1',
    at: 3,
  },
  {
    stage: 'propose',
    seatId: 'proposer-sonnet',
    role: 'proposer',
    kind: 'message',
    seq: 3,
    content: 'Write-back with an explicit invalidation hook.',
    broadcastId: 'bc-1',
    at: 4,
  },
  {
    stage: 'converge',
    seatId: 'conductor',
    role: 'conductor',
    kind: 'note',
    seq: 4,
    content: 'Debate closed after 1 round(s). Parking 2 final position(s).',
    at: 5,
  },
  {
    stage: 'converge',
    seatId: 'human',
    role: 'human',
    kind: 'note',
    seq: 5,
    content: 'Human verdict — ACCEPT: adopted seat "proposer-opus" (proposer).',
    at: 6,
  },
];

const meta = {
  title: 'Council/CouncilReplay',
  component: CouncilReplay,
  parameters: { layout: 'fullscreen' },
  args: {
    transcript: REPLAY_FIXTURE,
    onExit: fn(),
  },
} satisfies Meta<typeof CouncilReplay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  args: { transcript: [] },
};
