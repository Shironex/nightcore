import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { ProviderIcon } from './ProviderIcon';

const meta = {
  title: 'UI/ProviderIcon',
  component: ProviderIcon,
  args: {
    provider: 'claude',
    size: 40,
  },
  decorators: [
    (Story) => (
      <div style={{ padding: 24, color: 'var(--foreground, #e6e6f0)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProviderIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The `claude` provider → the Anthropic brand mark. */
export const Claude: Story = {};

/** The `codex` provider → the OpenAI brand mark. */
export const Codex: Story = { args: { provider: 'codex' } };

/** The `gemini` provider → the Gemini spark. */
export const Gemini: Story = { args: { provider: 'gemini' } };

/** A vendor alias (`openai`) still resolves to the right brand mark. */
export const VendorAlias: Story = { args: { provider: 'openai' } };

/** An unknown provider → the neutral fallback chip, labeled from its slug. */
export const UnknownProvider: Story = { args: { provider: 'mistral' } };

/** The size prop scales the mark; a title overrides the accessible name. */
export const LargeWithTitle: Story = {
  args: { provider: 'claude', size: 72, title: 'Anthropic Claude' },
};

/** Play test: the rendered mark is exposed as an image with the provider name. */
export const AnnouncesProviderName: Story = {
  args: { provider: 'gemini' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('img', { name: /gemini/i })).toBeInTheDocument();
  },
};
