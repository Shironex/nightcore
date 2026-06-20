import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

/**
 * Shell execution tool. This is the one genuinely dangerous capability in the
 * set: it runs an arbitrary command line. It is classified `mutating: true` in
 * the descriptor so the engine's PermissionLayer gates every invocation behind
 * an approval rather than auto-allowing it.
 *
 * The command runs through the user's shell (`/bin/sh -c`) so pipes and globs
 * behave as written; a timeout bounds runaway processes.
 */

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;

export const runCommandTool = tool(
  'run_command',
  'Run a shell command and return its combined stdout/stderr and exit code. DANGEROUS — gated by the permission layer.',
  {
    command: z.string().describe('The shell command line to execute.'),
    cwd: z.string().default('.').describe('Working directory for the command.'),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(MAX_TIMEOUT_MS)
      .default(DEFAULT_TIMEOUT_MS)
      .describe('Kill the command after this many milliseconds.'),
  },
  async (args) => {
    try {
      const { stdout, stderr } = await execFileAsync('/bin/sh', ['-c', args.command], {
        cwd: args.cwd,
        timeout: args.timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
      });
      const body = [stdout, stderr].filter(Boolean).join('\n').trim();
      return {
        content: [{ type: 'text', text: body || '(no output; exit 0)' }],
      };
    } catch (error) {
      const err = error as {
        message?: string;
        code?: number | string;
        stdout?: string;
        stderr?: string;
        killed?: boolean;
      };
      const parts = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();
      const reason = err.killed
        ? `timed out after ${args.timeoutMs}ms`
        : `exit code ${err.code ?? 'unknown'}`;
      const text = parts
        ? `Command failed (${reason}):\n${parts}`
        : `Command failed (${reason}): ${err.message ?? 'unknown error'}`;
      return {
        content: [{ type: 'text', text }],
        isError: true,
      };
    }
  },
);
