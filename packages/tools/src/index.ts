import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import type { ToolDescriptor } from '@nightcore/contracts';
import { echoTool } from './echo.js';
import { readFileTool } from './read-file.js';

export { echoTool } from './echo.js';
export { readFileTool } from './read-file.js';

/**
 * The name of the in-process SDK MCP server Nightcore registers. Tool names the
 * model sees are namespaced `mcp__<server>__<tool>`.
 */
export const NIGHTCORE_MCP_SERVER_NAME = 'nightcore';

/** Fully-qualified tool name as the model sees it. */
export function qualifiedToolName(toolName: string): string {
  return `mcp__${NIGHTCORE_MCP_SERVER_NAME}__${toolName}`;
}

/**
 * Every Nightcore-defined tool. The engine's ToolRegistry hands this array to
 * `createSdkMcpServer`. Capability packages export the raw definitions; they
 * never import the engine (dependency inversion).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const nightcoreTools: Array<SdkMcpToolDefinition<any>> = [
  echoTool,
  readFileTool,
];

/** Static metadata for each tool, for surfaces that want to render the catalog. */
export const nightcoreToolDescriptors: ToolDescriptor[] = [
  {
    name: qualifiedToolName('echo'),
    description: 'Echo a message back to the caller.',
    source: 'nightcore',
    mutating: false,
  },
  {
    name: qualifiedToolName('read_file'),
    description: 'Read a UTF-8 text file from the local filesystem.',
    source: 'nightcore',
    mutating: false,
  },
];
