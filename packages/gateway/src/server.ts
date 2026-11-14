/**
 * Gateway entry point: REST + OpenAPI (/docs) + MCP streamable HTTP (/mcp) + SSE audit stream.
 *   npm run dev -w @junction/gateway
 */
import { createGateway } from './bootstrap.js';
import { ConfigError } from './config.js';
import { buildServer } from './http/server.js';

async function main(): Promise<void> {
  const gw = await createGateway();
  const app = await buildServer({ service: gw.service, audit: gw.audit, key: gw.key });
  await app.listen({ port: gw.config.port, host: gw.config.host });
  console.log(`Valio Aimo gateway listening on ${gw.config.publicUrl}`);
  console.log(`  REST + OpenAPI  ${gw.config.publicUrl}/docs`);
  console.log(`  MCP (HTTP)      ${gw.config.publicUrl}/mcp`);
  console.log(`  JWKS            ${gw.config.publicUrl}/.well-known/jwks.json  (kid ${gw.key.kid})`);
  console.log(`  Audit SSE       ${gw.config.publicUrl}/v1/audit/stream`);
  const shutdown = async () => {
    await app.close();
    gw.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((e: unknown) => {
  if (e instanceof ConfigError) console.error(`Configuration error: ${e.message}`);
  else console.error(e);
  process.exit(1);
});
