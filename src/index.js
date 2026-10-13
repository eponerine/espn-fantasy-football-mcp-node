#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { FantasyApiClient } from './api-client.js';
import { loadConfig } from './config.js';
import { loadRuntimeConfig } from './runtime-config.js';
import { createServer } from './server.js';

try {
  const upstream = loadConfig();
  const runtime = loadRuntimeConfig();
  const client = new FantasyApiClient(upstream);
  const injuryReportCache = new Map();
  const factory = () => createServer({ client, injuryReportCache });

  if (runtime.transport === 'stdio') {
    // stdout is the JSON-RPC channel; all logging must go to stderr.
    console.error(
      `espn-fantasy-football MCP server on stdio -> ${upstream.baseUrl}` +
        (upstream.defaultLeagueId
          ? ` (league ${upstream.defaultLeagueId}, ${upstream.defaultYear ?? 'no year set'})`
          : ' (no default league configured)')
    );
    const server = factory();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    const stop = () => {
      void server.close().catch(() => {
        process.exitCode = 1;
      });
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  } else if (runtime.transport === 'streamable-http') {
    const { startHttp } = await import('./transports/http.js');
    const service = await startHttp(factory, runtime);
    console.error(
      `espn-fantasy-football MCP server on streamable-http -> http://${runtime.host}:${runtime.port}/mcp`
    );

    const shutdown = async () => {
      try {
        const result = await service.close();
        if (result?.forced) {
          process.exitCode = 1;
        }
      } catch (error) {
        console.error(`Error during HTTP shutdown: ${error?.message ?? error}`);
        process.exitCode = 1;
      }
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  }
} catch (error) {
  console.error(error?.message ?? String(error));
  process.exitCode = 1;
}
