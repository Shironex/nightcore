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
import type { ToolDescriptor, ToolRisk } from '@nightcore/contracts';

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

  /**
   * Look up a tool's risk class by the name the model uses. The model sees
   * fully-qualified names (`mcp__nightcore__run_command`); descriptors store the
   * same, but match is made robust to namespacing by falling back to a suffix
   * match. Returns `undefined` when no descriptor declares a risk — callers must
   * treat that as the most-cautious class (`dangerous`).
   */
  riskOf(toolName: string): ToolRisk | undefined {
    const descriptors = this.descriptors();
    const exact = descriptors.find((d) => d.name === toolName);
    if (exact) return exact.risk;
    const suffix = descriptors.find(
      (d) => d.name.endsWith(`__${toolName}`) || toolName.endsWith(`__${d.name}`),
    );
    return suffix?.risk;
  }
}
