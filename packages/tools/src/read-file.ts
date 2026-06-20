import * as fs from 'node:fs/promises';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

/**
 * A second example tool: read a UTF-8 text file. The SDK already ships a richer
 * built-in `Read`; this exists to demonstrate a Nightcore-defined tool that does
 * real I/O and returns an error result (rather than throwing) on failure, so the
 * model receives a usable tool_result either way.
 *
 * Non-mutating (read-only), so it sits in the auto-allow tier by default.
 */
export const readFileTool = tool(
  'read_file',
  'Read a UTF-8 text file from the local filesystem and return its contents.',
  { path: z.string().describe('Absolute or cwd-relative path to the file.') },
  async (args) => {
    try {
      const text = await fs.readFile(args.path, 'utf8');
      return { content: [{ type: 'text', text }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Failed to read file: ${message}` }],
        isError: true,
      };
    }
  },
);
