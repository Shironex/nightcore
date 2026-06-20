import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

/**
 * Trivial example tool — echoes its input back. Exists to prove the in-process
 * SDK MCP wiring end-to-end (registry → createSdkMcpServer → model can call it).
 * Non-mutating, so the permission layer auto-allows it.
 */
export const echoTool = tool(
  'echo',
  'Echo a message back to the caller. Useful as a connectivity check.',
  { message: z.string().describe('The message to echo back.') },
  async (args) => ({
    content: [{ type: 'text', text: args.message }],
  }),
);
