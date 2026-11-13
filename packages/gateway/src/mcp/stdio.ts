/**
 * MCP over stdio for Claude Desktop / Inspector:
 *   npm run mcp -w @junction/gateway        (or: npx tsx packages/gateway/src/mcp/stdio.ts)
 * Only stderr is used for diagnostics; stdout is the MCP channel.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createGateway } from '../bootstrap.js';
import { buildMcpServer } from './server.js';

async function main(): Promise<void> {
  const gw = await createGateway();
  const server = buildMcpServer(gw.service);
  await server.connect(new StdioServerTransport());
  console.error(`valio-aimo-gateway MCP server ready on stdio (kid ${gw.key.kid})`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
