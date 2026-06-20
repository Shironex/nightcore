import {
  createSdkMcpServer,
  type McpSdkServerConfigWithInstance,
} from '@anthropic-ai/claude-agent-sdk';
import {
  NIGHTCORE_MCP_SERVER_NAME,
  nightcoreTools,
  nightcoreToolDescriptors,
} from '@nightcore/tools';
import { externalMcpServers } from '@nightcore/mcp';
import type { ToolDescriptor } from '@nightcore/contracts';

/**
 * Assembles the tool surface handed to the SDK:
 *   - one in-process SDK MCP server (`createSdkMcpServer`) holding every
 *     Nightcore-defined tool from `@nightcore/tools`;
 *   - the static descriptor catalog for surfaces to render.
 *
 * External MCP servers (`@nightcore/mcp`) are exposed as descriptors here too,
 * but wiring their live transports into SDK `mcpServers` is deferred (the
 * placeholder registry is empty for the foundation).
 */
export class ToolRegistry {
  /** Build the in-process SDK MCP server instance. */
  buildSdkMcpServer(): McpSdkServerConfigWithInstance {
    return createSdkMcpServer({
      name: NIGHTCORE_MCP_SERVER_NAME,
      version: '0.0.0',
      tools: nightcoreTools,
    });
  }

  /** The `mcpServers` map for SDK `Options`. */
  mcpServers(): Record<string, McpSdkServerConfigWithInstance> {
    return { [NIGHTCORE_MCP_SERVER_NAME]: this.buildSdkMcpServer() };
  }

  /** Every tool descriptor known to the harness (Nightcore + external MCP). */
  descriptors(): ToolDescriptor[] {
    const external: ToolDescriptor[] = externalMcpServers.map((server) => ({
      name: `mcp__${server.name}`,
      description: `External MCP server: ${server.command}`,
      source: 'external-mcp',
      mutating: true,
    }));
    return [...nightcoreToolDescriptors, ...external];
  }
}
