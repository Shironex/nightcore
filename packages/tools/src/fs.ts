import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

/**
 * Filesystem tools. `read_file` lives in `./read-file.ts` (the original
 * example); this module adds the mutating siblings plus a read-only directory
 * listing. Every tool returns an error *result* (`isError: true`) on failure
 * rather than throwing, so the model always receives a usable tool_result.
 *
 * Mutating classification:
 *   - write_file  → mutating (creates/overwrites)
 *   - edit_file   → mutating (rewrites in place)
 *   - list_dir    → read-only
 */

function errorResult(prefix: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text' as const, text: `${prefix}: ${message}` }],
    isError: true,
  };
}

/** Write (create or overwrite) a UTF-8 text file. Mutating. */
export const writeFileTool = tool(
  'write_file',
  'Write a UTF-8 text file, creating parent directories as needed. Overwrites any existing file.',
  {
    path: z.string().describe('Absolute or cwd-relative path to write.'),
    content: z.string().describe('Full UTF-8 contents to write.'),
  },
  async (args) => {
    try {
      await fs.mkdir(path.dirname(path.resolve(args.path)), { recursive: true });
      await fs.writeFile(args.path, args.content, 'utf8');
      const bytes = Buffer.byteLength(args.content, 'utf8');
      return {
        content: [{ type: 'text', text: `Wrote ${bytes} byte(s) to ${args.path}` }],
      };
    } catch (error) {
      return errorResult('Failed to write file', error);
    }
  },
);

/**
 * Exact string-replacement edit. Reads the file, replaces `oldString` with
 * `newString`, and writes it back. Fails (without writing) when `oldString` is
 * absent, or when it is ambiguous and `replaceAll` was not requested. Mutating.
 */
export const editFileTool = tool(
  'edit_file',
  'Edit a text file by replacing an exact string. Fails if the string is missing or ambiguous (unless replaceAll is set).',
  {
    path: z.string().describe('Absolute or cwd-relative path to edit.'),
    oldString: z.string().describe('Exact text to find. Must be unique unless replaceAll is true.'),
    newString: z.string().describe('Text to replace it with.'),
    replaceAll: z
      .boolean()
      .default(false)
      .describe('Replace every occurrence instead of requiring a unique match.'),
  },
  async (args) => {
    try {
      const original = await fs.readFile(args.path, 'utf8');
      const result = applyEdit(original, args.oldString, args.newString, args.replaceAll);
      if (!result.ok) {
        return {
          content: [{ type: 'text', text: result.reason }],
          isError: true,
        };
      }
      await fs.writeFile(args.path, result.text, 'utf8');
      return {
        content: [
          {
            type: 'text',
            text: `Replaced ${result.replacements} occurrence(s) in ${args.path}`,
          },
        ],
      };
    } catch (error) {
      return errorResult('Failed to edit file', error);
    }
  },
);

/**
 * Pure core of `edit_file`, exported for deterministic unit testing. Counts
 * occurrences first so an ambiguous single-replace never silently mutates.
 */
export function applyEdit(
  source: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
):
  | { ok: true; text: string; replacements: number }
  | { ok: false; reason: string } {
  if (oldString === '') {
    return { ok: false, reason: 'oldString must not be empty.' };
  }
  const count = source.split(oldString).length - 1;
  if (count === 0) {
    return { ok: false, reason: 'oldString not found in file.' };
  }
  if (count > 1 && !replaceAll) {
    return {
      ok: false,
      reason: `oldString is ambiguous (${count} matches); pass replaceAll or provide a more specific string.`,
    };
  }
  const text = replaceAll
    ? source.split(oldString).join(newString)
    : source.replace(oldString, newString);
  return { ok: true, text, replacements: replaceAll ? count : 1 };
}

/** List the entries of a directory, annotating type. Read-only. */
export const listDirTool = tool(
  'list_dir',
  'List the entries of a directory, marking each as a file, directory, or symlink.',
  {
    path: z.string().default('.').describe('Directory to list. Defaults to the cwd.'),
  },
  async (args) => {
    try {
      const entries = await fs.readdir(args.path, { withFileTypes: true });
      if (entries.length === 0) {
        return { content: [{ type: 'text', text: `(empty) ${args.path}` }] };
      }
      const lines = entries
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => {
          const kind = entry.isDirectory()
            ? 'dir '
            : entry.isSymbolicLink()
              ? 'link'
              : 'file';
          return `${kind}  ${entry.name}`;
        });
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (error) {
      return errorResult('Failed to list directory', error);
    }
  },
);
