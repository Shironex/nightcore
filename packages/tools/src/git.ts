import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

/**
 * Git tools. Both shell out to `git` via `execFile` (no shell interpolation) and
 * are read-only — they only ever invoke `status` / `diff`, never a mutating
 * subcommand. Failures (not a repo, git missing) return an error result.
 */

const execFileAsync = promisify(execFile);

export interface GitStatusEntry {
  /** Two-character porcelain status code, e.g. " M", "??", "A ". */
  status: string;
  /** Path relative to the repo root. */
  path: string;
}

/**
 * Parse `git status --porcelain` output into structured entries. Exported so the
 * parsing is unit-testable without spawning git. Handles renames (`R  a -> b`)
 * by reporting the destination path.
 */
export function parseGitStatus(porcelain: string): GitStatusEntry[] {
  const entries: GitStatusEntry[] = [];
  for (const rawLine of porcelain.split('\n')) {
    if (rawLine.length < 4) continue;
    const status = rawLine.slice(0, 2);
    let pathPart = rawLine.slice(3);
    const arrow = pathPart.indexOf(' -> ');
    if (arrow !== -1) {
      pathPart = pathPart.slice(arrow + 4);
    }
    entries.push({ status, path: pathPart });
  }
  return entries;
}

/** Human-readable label for the more common porcelain codes. */
export function describeStatus(code: string): string {
  const map: Record<string, string> = {
    ' M': 'modified',
    'M ': 'staged',
    'MM': 'staged+modified',
    'A ': 'added',
    ' D': 'deleted',
    'D ': 'staged-deletion',
    'R ': 'renamed',
    '??': 'untracked',
    '!!': 'ignored',
  };
  return map[code] ?? (code.trim() || 'changed');
}

async function runGit(cwd: string, gitArgs: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', gitArgs, {
    cwd,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

function errorResult(prefix: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text' as const, text: `${prefix}: ${message}` }],
    isError: true,
  };
}

/** Show the working-tree status of a git repo. Read-only. */
export const gitStatusTool = tool(
  'git_status',
  'Show the git working-tree status (staged, modified, and untracked files).',
  {
    cwd: z.string().default('.').describe('Path inside the git repo. Defaults to the cwd.'),
  },
  async (args) => {
    try {
      const out = await runGit(args.cwd, ['status', '--porcelain']);
      const entries = parseGitStatus(out);
      if (entries.length === 0) {
        return { content: [{ type: 'text', text: 'Working tree clean.' }] };
      }
      const text = entries
        .map((entry) => `${describeStatus(entry.status).padEnd(16)} ${entry.path}`)
        .join('\n');
      return { content: [{ type: 'text', text }] };
    } catch (error) {
      return errorResult('git status failed', error);
    }
  },
);

/** Show the diff of the working tree (optionally staged). Read-only. */
export const gitDiffTool = tool(
  'git_diff',
  'Show the git diff of the working tree. Set staged=true for the index diff.',
  {
    cwd: z.string().default('.').describe('Path inside the git repo. Defaults to the cwd.'),
    staged: z.boolean().default(false).describe('Diff the staged index instead of the working tree.'),
  },
  async (args) => {
    try {
      const gitArgs = ['diff'];
      if (args.staged) gitArgs.push('--staged');
      const out = await runGit(args.cwd, gitArgs);
      const text = out.trim();
      return {
        content: [{ type: 'text', text: text || 'No changes.' }],
      };
    } catch (error) {
      return errorResult('git diff failed', error);
    }
  },
);
