import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

/**
 * Search tools. `grep` prefers ripgrep (`rg`) when it is on PATH and falls back
 * to a pure-Node walk + RegExp when it is not, so the tool degrades gracefully
 * and never throws because a binary is missing. `glob` is a small Node matcher
 * (no external glob dependency). Both are read-only.
 */

const execFileAsync = promisify(execFile);

const DEFAULT_IGNORES = new Set(['.git', 'node_modules', 'dist', '.next', 'coverage']);
const MAX_RESULTS = 500;

/** True iff `rg` is invocable. Cached after the first probe. */
let rgAvailable: boolean | undefined;
async function hasRipgrep(): Promise<boolean> {
  if (rgAvailable !== undefined) return rgAvailable;
  try {
    await execFileAsync('rg', ['--version']);
    rgAvailable = true;
  } catch {
    rgAvailable = false;
  }
  return rgAvailable;
}

/** Translate a glob pattern (supporting `*`, `?`, `**`) into a RegExp. */
export function globToRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // `**` matches across path separators; consume an optional trailing slash.
        re += '.*';
        i++;
        if (pattern[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else if (ch !== undefined && '.+^${}()|[]\\'.includes(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch ?? '';
    }
  }
  return new RegExp(`^${re}$`);
}

/** Recursively collect file paths under `root`, skipping ignored dirs. */
async function walk(root: string, limit: number): Promise<string[]> {
  const out: string[] = [];
  async function recurse(dir: string): Promise<void> {
    if (out.length >= limit) return;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (entry.name.startsWith('.') && DEFAULT_IGNORES.has(entry.name)) continue;
      if (DEFAULT_IGNORES.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await recurse(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }
  await recurse(root);
  return out;
}

/** Match a list of relative paths against a glob. Exported for testing. */
export function filterByGlob(relativePaths: string[], pattern: string): string[] {
  const regex = globToRegExp(pattern);
  return relativePaths.filter((p) => regex.test(p));
}

/** Find files whose path matches a glob pattern. Read-only. */
export const globTool = tool(
  'glob',
  'Find files by glob pattern (supports *, ?, and **). Skips .git/node_modules/dist by default.',
  {
    pattern: z.string().describe('Glob pattern, e.g. "src/**/*.ts".'),
    cwd: z.string().default('.').describe('Directory to search from. Defaults to the cwd.'),
  },
  async (args) => {
    try {
      const root = path.resolve(args.cwd);
      const files = await walk(root, MAX_RESULTS);
      const relative = files.map((f) => path.relative(root, f));
      const matched = filterByGlob(relative, args.pattern).sort();
      if (matched.length === 0) {
        return { content: [{ type: 'text', text: `No files match: ${args.pattern}` }] };
      }
      return { content: [{ type: 'text', text: matched.join('\n') }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Glob failed: ${message}` }],
        isError: true,
      };
    }
  },
);

/** Run the Node fallback grep: walk + per-line RegExp. Exported for testing. */
export async function grepNode(
  pattern: string,
  root: string,
  flags: string,
): Promise<string[]> {
  const regex = new RegExp(pattern, flags);
  const files = await walk(root, MAX_RESULTS);
  const hits: string[] = [];
  for (const file of files) {
    if (hits.length >= MAX_RESULTS) break;
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    const rel = path.relative(root, file);
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line !== undefined && regex.test(line)) {
        hits.push(`${rel}:${i + 1}:${line}`);
        if (hits.length >= MAX_RESULTS) break;
      }
    }
  }
  return hits;
}

/**
 * Search file contents by regex. Prefers ripgrep; falls back to a Node walk so
 * the tool works even where `rg` is absent. Read-only.
 */
export const grepTool = tool(
  'grep',
  'Search file contents by regex. Uses ripgrep when available, otherwise a built-in Node search.',
  {
    pattern: z.string().describe('Regular expression to search for.'),
    cwd: z.string().default('.').describe('Directory to search from. Defaults to the cwd.'),
    ignoreCase: z.boolean().default(false).describe('Case-insensitive match.'),
  },
  async (args) => {
    const root = path.resolve(args.cwd);
    try {
      if (await hasRipgrep()) {
        const rgArgs = ['--line-number', '--no-heading', '--color', 'never'];
        if (args.ignoreCase) rgArgs.push('--ignore-case');
        rgArgs.push('--', args.pattern, root);
        try {
          const { stdout } = await execFileAsync('rg', rgArgs, {
            maxBuffer: 8 * 1024 * 1024,
          });
          const text = stdout.trim();
          return {
            content: [{ type: 'text', text: text || `No matches for: ${args.pattern}` }],
          };
        } catch (error) {
          // rg exits 1 when there are simply no matches — not an error for us.
          const code = (error as { code?: number }).code;
          if (code === 1) {
            return { content: [{ type: 'text', text: `No matches for: ${args.pattern}` }] };
          }
          throw error;
        }
      }
      const hits = await grepNode(args.pattern, root, args.ignoreCase ? 'i' : '');
      return {
        content: [
          {
            type: 'text',
            text: hits.length ? hits.join('\n') : `No matches for: ${args.pattern}`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Grep failed: ${message}` }],
        isError: true,
      };
    }
  },
);
