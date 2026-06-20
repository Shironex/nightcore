#!/usr/bin/env bun
/**
 * `bun run new:tool <name> "<description>"` — scaffolds a new in-process SDK MCP
 * tool end-to-end:
 *   1. writes `packages/tools/src/<name>.ts` from a template (correct `tool()`
 *      shape);
 *   2. auto-registers it in `packages/tools/src/index.ts` — adds the import, the
 *      re-export, the `nightcoreTools` array entry, and a `nightcoreToolDescriptors`
 *      entry (read-only by default; pass `--mutating` to gate it);
 *   3. emits a co-located `<name>.test.ts` (bun:test) with a basic handler
 *      assertion.
 *
 * Mirrors shiranami's `pnpm new:component` codegen.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOLS_SRC = path.resolve(dirname, '../../packages/tools/src');
const INDEX_FILE = path.join(TOOLS_SRC, 'index.ts');

function toSnake(name: string): string {
  return name
    .replace(/[-\s]+/g, '_')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

function toCamel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function toolTemplate(snakeName: string, camelName: string, description: string): string {
  return `import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

/**
 * ${description}
 */
export const ${camelName}Tool = tool(
  '${snakeName}',
  '${description}',
  { input: z.string().describe('TODO: describe the input.') },
  async (args) => {
    try {
      // TODO: implement. Return an error *result* (isError: true) on failure
      // rather than throwing, so the model always receives a usable tool_result.
      return { content: [{ type: 'text', text: args.input }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: \`${snakeName} failed: \${message}\` }],
        isError: true,
      };
    }
  },
);
`;
}

function testTemplate(snakeName: string, camelName: string, fileBase: string): string {
  return `import { test, expect } from 'bun:test';
import { ${camelName}Tool } from './${fileBase}.js';

test('${snakeName} returns a tool_result', async () => {
  const result = await ${camelName}Tool.handler({ input: 'hello' }, {} as never);
  expect(result.isError).not.toBe(true);
  expect(result.content[0]?.text).toBe('hello');
});
`;
}

/**
 * Insert a line after the last existing line that matches `anchor`. Pure string
 * surgery so the codegen stays dependency-free (no AST).
 */
function insertAfterLast(source: string, anchor: RegExp, line: string): string {
  const lines = source.split('\n');
  let lastIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (anchor.test(lines[i] ?? '')) lastIdx = i;
  }
  if (lastIdx === -1) {
    throw new Error(`Could not find anchor ${anchor} in ${INDEX_FILE}`);
  }
  lines.splice(lastIdx + 1, 0, line);
  return lines.join('\n');
}

/** Insert a multi-line block immediately before the closing `]` of a named array. */
function insertIntoArray(source: string, declStart: string, block: string): string {
  const startIdx = source.indexOf(declStart);
  if (startIdx === -1) {
    throw new Error(`Could not find "${declStart}" in ${INDEX_FILE}`);
  }
  const closeIdx = source.indexOf('\n];', startIdx);
  if (closeIdx === -1) {
    throw new Error(`Could not find end of array starting at "${declStart}"`);
  }
  return `${source.slice(0, closeIdx)}\n${block}${source.slice(closeIdx)}`;
}

function register(
  snakeName: string,
  camelName: string,
  fileBase: string,
  description: string,
  mutating: boolean,
): void {
  let source = fs.readFileSync(INDEX_FILE, 'utf8');

  // 1. import — after the last local import.
  source = insertAfterLast(
    source,
    /^import .* from '\.\/.*\.js';$/,
    `import { ${camelName}Tool } from './${fileBase}.js';`,
  );

  // 2. re-export — after the last local re-export.
  source = insertAfterLast(
    source,
    /^export \{.*\} from '\.\/.*\.js';$/,
    `export { ${camelName}Tool } from './${fileBase}.js';`,
  );

  // 3. nightcoreTools array entry.
  source = insertIntoArray(source, 'export const nightcoreTools', `  ${camelName}Tool,`);

  // 4. descriptor entry.
  const descriptor = [
    '  {',
    `    name: qualifiedToolName('${snakeName}'),`,
    `    description: '${description}',`,
    "    source: 'nightcore',",
    `    mutating: ${mutating},`,
    '  },',
  ].join('\n');
  source = insertIntoArray(source, 'export const nightcoreToolDescriptors', descriptor);

  fs.writeFileSync(INDEX_FILE, source, 'utf8');
}

function main(): void {
  const argv = process.argv.slice(2);
  const mutating = argv.includes('--mutating');
  const positional = argv.filter((a) => !a.startsWith('--'));
  const rawName = positional[0];
  const description = positional[1] ?? 'TODO: describe this tool.';

  if (!rawName) {
    process.stderr.write('Usage: bun run new:tool <name> "<description>" [--mutating]\n');
    process.exit(1);
  }

  const snakeName = toSnake(rawName);
  const camelName = toCamel(snakeName);
  const fileBase = snakeName.replace(/_/g, '-');
  const toolFile = path.join(TOOLS_SRC, `${fileBase}.ts`);
  const testFile = path.join(TOOLS_SRC, `${fileBase}.test.ts`);

  if (fs.existsSync(toolFile)) {
    process.stderr.write(`Tool already exists: ${toolFile}\n`);
    process.exit(1);
  }

  fs.writeFileSync(toolFile, toolTemplate(snakeName, camelName, description), 'utf8');
  fs.writeFileSync(testFile, testTemplate(snakeName, camelName, fileBase), 'utf8');
  register(snakeName, camelName, fileBase, description, mutating);

  process.stdout.write(`Created ${toolFile}\n`);
  process.stdout.write(`Created ${testFile}\n`);
  process.stdout.write(
    `Registered ${camelName}Tool in ${path.relative(process.cwd(), INDEX_FILE)} ` +
      `(${mutating ? 'mutating' : 'read-only'}).\n`,
  );
  process.stdout.write(`\nNext: implement the handler in ${path.relative(process.cwd(), toolFile)}.\n`);
}

main();
