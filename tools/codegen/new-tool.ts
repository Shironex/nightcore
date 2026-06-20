#!/usr/bin/env bun
/**
 * `bun run new:tool <name> "<description>"` — scaffolds a new in-process SDK MCP
 * tool in `packages/tools/src/<name>.ts` and reminds the author to register it.
 *
 * Mirrors shiranami's `pnpm new:component` codegen. Working stub: it writes a
 * tool file from a template; auto-wiring into `packages/tools/src/index.ts` and a
 * matching test are left as TODOs (intentionally minimal for the foundation).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOLS_SRC = path.resolve(__dirname, '../../packages/tools/src');

function toSnake(name: string): string {
  return name
    .replace(/[-\s]+/g, '_')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

function toCamel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function template(snakeName: string, camelName: string, description: string): string {
  return `import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

/**
 * ${description}
 */
export const ${camelName}Tool = tool(
  '${snakeName}',
  '${description}',
  { input: z.string().describe('TODO: describe the input.') },
  async (args) => ({
    content: [{ type: 'text', text: args.input }],
  }),
);
`;
}

function main(): void {
  const [rawName, description = 'TODO: describe this tool.'] = process.argv.slice(2);
  if (!rawName) {
    process.stderr.write('Usage: bun run new:tool <name> "<description>"\n');
    process.exit(1);
  }

  const snakeName = toSnake(rawName);
  const camelName = toCamel(snakeName);
  const file = path.join(TOOLS_SRC, `${snakeName.replace(/_/g, '-')}.ts`);

  if (fs.existsSync(file)) {
    process.stderr.write(`Tool already exists: ${file}\n`);
    process.exit(1);
  }

  fs.writeFileSync(file, template(snakeName, camelName, description), 'utf8');
  process.stdout.write(`Created ${file}\n`);
  process.stdout.write(
    `\nNext steps (manual for now):\n` +
      `  1. Register \`${camelName}Tool\` in packages/tools/src/index.ts (nightcoreTools + descriptors).\n` +
      `  2. Add a test alongside it.\n`,
  );
}

main();
