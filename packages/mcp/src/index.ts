/**
 * @nightcore/mcp — placeholder registry for EXTERNAL MCP server configs
 * (stdio / SSE / HTTP servers the user wants Nightcore to connect to).
 *
 * Distinct from `@nightcore/tools`, which holds IN-PROCESS SDK MCP tools. This
 * package only describes external servers; the engine merges them into the SDK
 * `mcpServers` option. Empty, typed registry for the foundation.
 *
 * Imports `contracts` only — never the engine (dependency inversion).
 */

/** Minimal external MCP server descriptor (stdio transport). The engine maps
 *  this onto the SDK's `McpServerConfig`; re-declared here to stay SDK-free. */
export interface ExternalMcpServer {
  /** Registry key / server name. */
  name: string;
  /** Executable to spawn. */
  command: string;
  /** Arguments passed to the command. */
  args?: string[];
  /** Extra environment for the spawned server. */
  env?: Record<string, string>;
}

/** Registered external MCP servers. Empty for the foundation. */
export const externalMcpServers: ExternalMcpServer[] = [];
