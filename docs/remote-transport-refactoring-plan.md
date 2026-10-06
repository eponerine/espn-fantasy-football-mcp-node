# Remote MCP Transport Refactoring Plan

## Recommendation

Keep stdio as the default and add stateless Streamable HTTP at `/mcp`.
Use Express for routing and security middleware, and the SDK's Node adapter for
MCP framing. Express alone is not an MCP transport. Do not introduce the legacy
HTTP+SSE `/sse` and `/messages` endpoints unless a specific old client requires them.

This document records the original design proposal. Dual transports and Docker
packaging have since been implemented; use the root README and current source as
the operational reference. Snippets below describe the design, not exact current files.

## Current Coupling

| Existing file | Finding | Required change |
| --- | --- | --- |
| [src/index.js](../src/index.js) | Imports `McpServer` and `serveStdio`, defines a factory, registers everything, logs and starts immediately. Configuration is loaded twice. There is no explicit `StdioServerTransport` construction. | Extract the factory and leave transport selection here. |
| [src/tools/index.js](../src/tools/index.js) | Registers six tool groups against a supplied server/client. | Forward injected analysis cache state. |
| [src/tools/shared.js](../src/tools/shared.js) | Returns MCP content and catches tool errors; does not read stdin or write stdout. | No transport changes. |
| [src/tools/analysis-tools.js](../src/tools/analysis-tools.js) | Owns a registration-local 30-minute injury-report cache. | Inject it so it survives per-request server creation. |
| [src/resources/index.js](../src/resources/index.js) | Registers fixed MCP URIs and callbacks using the API client. | No changes; `fantasy://` identifiers remain resource URIs, not HTTP routes. |
| [src/prompts/index.js](../src/prompts/index.js) | Registers prompts and returns MCP messages. | No changes. |
| [src/api-client.js](../src/api-client.js) | Uses `fetch`, configuration-bound credentials and a private response cache. | Reuse one client per process for a single trusted league deployment. |
| [src/config.js](../src/config.js) | Contains upstream settings only. | Keep it focused; add a separate runtime configuration module. |

The other tool groups and domain modules need no transport rewrites. Their handlers
are supplied a client and return protocol values, not transport-specific streams.
No tool implementation in `src/tools` references stdio or process streams.

The cache-lifetime hypothesis is directly testable: register tools on two distinct
servers backed by the same client/cache, call `get_injury_report` with identical
arguments, and assert the second result has `served_from_cache: true` without
rebuilding the report.

## 1. Dependencies and Scripts

Update [package.json](../package.json) and [package-lock.json](../package-lock.json)
together. The installed server is `2.0.0`; the published Node adapter `2.1.1`
requires server `^2.3.0`. Do not copy v1 imports from
`@modelcontextprotocol/sdk/server/streamableHttp.js` into this v2 repository.

Proposed installation command, to run during implementation:

```powershell
npm install @modelcontextprotocol/server@^2.3.0 @modelcontextprotocol/node@^2.1.1 @modelcontextprotocol/express@^2.0.2 express@^5
```

Keep `zod` and `pdfkit`; this refactor does not require removing existing dependencies.
No TypeScript build, dotenv package, or CORS dependency is needed for LibreChat's
server-to-server connections. Add CORS only for a real browser client, with explicit
origins and MCP header exposure rather than `*`.

Add these scripts without changing the existing `start`, `test` or `inspect` behavior:

```json
{
  "start:stdio": "node src/index.js --transport=stdio",
  "start:http": "node src/index.js --transport=streamable-http"
}
```

## 2. New src/server.js

Move `McpServer`, registration imports, and the complete `SERVER_INSTRUCTIONS`
constant from the entrypoint here. Change the factory to accept process-owned
dependencies; do not load environment variables inside the factory.

```js
export function createServer({ client, injuryReportCache }) {
  const server = new McpServer(
    { name: 'espn-fantasy-football', version: '0.1.0' },
    { instructions: SERVER_INSTRUCTIONS }
  );
  registerAllTools(server, client, { injuryReportCache });
  registerResources(server, client);
  registerPrompts(server);
  return server;
}
```

Creating a fresh MCP server is cheap; upstream ESPN requests are the expensive part.
Never connect one `McpServer` to multiple simultaneous HTTP transports. Share
business dependencies, not protocol connection state.

## 3. Preserve Analysis Cache Lifetime

In [src/tools/index.js](../src/tools/index.js), accept and forward the cache:

```js
export function registerAllTools(server, client, analysisState = {}) {
  registerLeagueTools(server, client);
  registerMatchupTools(server, client);
  registerPlayerTools(server, client);
  registerTransactionTools(server, client);
  registerAnalysisTools(server, client, analysisState);
  registerKnowledgeTools(server);
}
```

In [src/tools/analysis-tools.js](../src/tools/analysis-tools.js), replace the
signature and local `new Map()` with:

```js
export function registerAnalysisTools(
  server, client, { injuryReportCache = new Map() } = {}
) {
  // Keep the existing tool registrations in this function.
}
```

Keep the existing league/year/week/topN cache key and TTL. For a long-running
network service, also bound this cache and evict expired entries: unlike the API
client cache, the current report cache has no size limit. Concurrent identical
misses can still duplicate work; request coalescing is a useful follow-up, not a
prerequisite for transport support. The existing concurrency limit of four is
per invocation, not a global limit across HTTP clients; set proxy/application
rate limits to protect the upstream API.

## 4. New src/runtime-config.js

Use Node's built-in argument parser. Precedence is CLI, then environment, then
defaults. Fail on unsupported transports and invalid ports rather than silently
falling back. Keep the bind host distinct from accepted request hostnames.

```js
import { parseArgs } from 'node:util';

export function loadRuntimeConfig(env = process.env, args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    transport: { type: 'string' },
    host: { type: 'string' },
    port: { type: 'string' }
  } });
  const transport = values.transport ?? env.MCP_TRANSPORT ?? 'stdio';
  if (!['stdio', 'streamable-http'].includes(transport)) {
    throw new Error(`Unsupported MCP transport: ${transport}`);
  }
  const port = Number(values.port ?? env.MCP_PORT ?? '3001');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('MCP_PORT must be an integer from 1 to 65535');
  }
  const list = (value) => (value ?? '').split(',').map(part => part.trim()).filter(Boolean);
  const config = {
    transport, port,
    host: values.host ?? env.MCP_HOST ?? '127.0.0.1',
    allowedHosts: list(env.MCP_ALLOWED_HOSTS),
    allowedOrigins: list(env.MCP_ALLOWED_ORIGINS),
    token: env.MCP_AUTH_TOKEN || null
  };
  if (transport === 'streamable-http' &&
      (!config.token || !config.allowedHosts.length)) {
    throw new Error('HTTP requires MCP_AUTH_TOKEN and MCP_ALLOWED_HOSTS');
  }
  return config;
}
```

This deliberately fails closed for network mode. If an authenticated gateway
replaces application authentication later, make that an explicit deployment mode
with tests, not an implicit exemption for `0.0.0.0`.

## 5. New src/transports/http.js

The following is the central HTTP application factory. The SDK adapter owns JSON-RPC
validation, version headers, notifications and response framing. JSON response mode
is valid Streamable HTTP and fits the existing request/response tools.

```js
import { timingSafeEqual } from 'node:crypto';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';

export function createHttpApp(createServer, config) {
  const app = createMcpExpressApp({
    host: config.host,
    allowedHosts: config.allowedHosts,
    allowedOrigins: config.allowedOrigins,
    jsonLimit: '1mb'
  });
  const activeServers = new Set();
  app.disable('x-powered-by');
  app.get('/healthz', (_request, response) => response.json({ status: 'ok' }));
  app.use('/mcp', (request, response, next) => {
    const actual = Buffer.from(request.get('authorization') ?? '');
    const expected = Buffer.from(`Bearer ${config.token}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return response.status(401).json({ error: 'Unauthorized' });
    }
    const origin = request.get('origin');
    if (origin && !config.allowedOrigins.length) {
      return response.status(403).json({ error: 'Origin not allowed' });
    }
    next();
  });
  app.post('/mcp', async (request, response, next) => {
    const server = createServer();
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    activeServers.add(server);
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      activeServers.delete(server);
      void server.close().catch(error => console.error('MCP close failed', error));
    };
    response.once('finish', cleanup);
    response.once('close', cleanup);
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      cleanup();
      next(error);
    }
  });
  app.all('/mcp', (_request, response) => {
    response.set('Allow', 'POST').status(405).end();
  });
  app.use((error, _request, response, next) => {
    if (response.headersSent) return next(error);
    const status = error.type === 'entity.too.large' ? 413 :
      error.type === 'entity.parse.failed' ? 400 : 500;
    if (status === 500) console.error('MCP HTTP request failed');
    response.status(status).json({ error: status === 500 ? 'Internal server error' : 'Invalid body' });
  });
  return { app, activeServers };
}
```

Do not close the transport in a `finally` immediately after `handleRequest`: its
promise may finish before the response stream has finished. Response lifecycle
cleanup avoids prematurely closing an in-flight tool response. Test early client
disconnects, including disconnects during connection setup, when implementing
this skeleton; add a post-connect closed check if that race is observed.

`GET /mcp` and `DELETE /mcp` return 405 because this proposal has no standalone
notification stream or sessions. This is not a failed legacy SSE endpoint.
`/healthz` is a liveness check, not the existing `get_health` tool and not proof of
ESPN availability. A separate readiness endpoint may check upstream connectivity.

When implementing the listener, export `startHttp(createServer, config)` that
calls this factory and awaits `app.listen(config.port, config.host)`, including
listen error handling. On SIGTERM/SIGINT, stop accepting requests with
`httpServer.close()`, drain existing requests, and clear a shutdown deadline when
draining finishes. At the deadline, close remaining MCP servers and call
`httpServer.closeAllConnections()`; exit nonzero if shutdown fails. Do not terminate
the process before successful response draining. Choose a deadline longer than
the typical tool duration and configure Docker's stop grace period accordingly.

For public deployments terminate TLS at a trusted reverse proxy, apply rate limits,
and configure request timeouts for multi-call injury reports. Do not enable broad
`trust proxy` settings without a known proxy boundary. If later using SSE responses,
disable proxy buffering and allow long-lived connections.

## 6. Refactor src/index.js

Keep the shebang and public entrypoint; initialize upstream settings and caches once.
Use an explicit stdio transport so its lifecycle can be closed on process signals.

```js
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { FantasyApiClient } from './api-client.js';
import { loadConfig } from './config.js';
import { loadRuntimeConfig } from './runtime-config.js';
import { createServer } from './server.js';

const upstream = loadConfig();
const runtime = loadRuntimeConfig();
const client = new FantasyApiClient(upstream);
const injuryReportCache = new Map();
const factory = () => createServer({ client, injuryReportCache });
console.error(`MCP transport=${runtime.transport} upstream=${upstream.baseUrl}`);
if (runtime.transport === 'stdio') {
  const server = factory();
  await server.connect(new StdioServerTransport());
  const stop = () => { void server.close().catch(() => { process.exitCode = 1; }); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
} else {
  const { startHttp } = await import('./transports/http.js');
  await startHttp(factory, runtime);
}
```

Wrap startup in a top-level try/catch in the implementation to emit a concise stderr
error and set a failing exit code. Keep all diagnostics on stderr in both modes;
stdout remains exclusively JSON-RPC in stdio mode. Dynamic HTTP import avoids
running HTTP middleware initialization during local stdio startup.

Examples: `npm start` retains stdio; `npm run start:http` selects HTTP;
`npm start -- --transport=stdio` overrides `MCP_TRANSPORT=streamable-http`.

## 7. New Dockerfile and .dockerignore

Plain ESM needs no build stage. Use a supported Node LTS image, deterministic
production installation, a non-root user and an exec-form command. Pin an image
digest in release automation when exact base-image reproducibility is required.

```dockerfile
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production MCP_TRANSPORT=streamable-http MCP_HOST=0.0.0.0 MCP_PORT=3001
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node src ./src
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.MCP_PORT||3001)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
```

New `.dockerignore`:

```text
node_modules
.git
.vscode
.env
.env.*
test
docs
coverage
npm-debug.log*
```

Supply tokens and ESPN cookies only at runtime, never with `ARG`, `ENV`, or copied
environment files in an image. No persistent volume is required for current caches.
The default image is HTTP, but overriding `MCP_TRANSPORT=stdio` and using `docker run
--rm -i` still supports stdio. Avoid `-t`, which allocates a protocol-disrupting TTY.

## 8. Container Networking and LibreChat

Optional new `compose.yaml` service, attached to the same Docker network as
LibreChat and the separately deployed fantasy API. Declare that shared network
as external if the services are in different Compose projects.

```yaml
services:
  fantasy-mcp:
    build: .
    init: true
    restart: unless-stopped
    stop_grace_period: 60s
    environment:
      MCP_AUTH_TOKEN: ${MCP_AUTH_TOKEN:?Set MCP_AUTH_TOKEN}
      MCP_ALLOWED_HOSTS: fantasy-mcp,localhost,127.0.0.1
      FF_API_BASE_URL: http://fantasy-api:3000
      LEAGUE_ID: ${LEAGUE_ID}
      SEASON_YEAR: ${SEASON_YEAR}
    expose:
      - "3001"
```

`expose` does not publish a host port; clients on the shared Docker network can
connect directly. If host access is needed, add `127.0.0.1:3001:3001` to `ports`.
Include `127.0.0.1` in the host allowlist for the Docker healthcheck. Allowed hosts
are hostnames, not URLs or `hostname:port` entries, for this SDK middleware.

Do not retain `FF_API_BASE_URL=http://localhost:3000` in the MCP container:
localhost points to that container, not the API container. On Windows Docker
Desktop, use `http://host.docker.internal:3000` if the API runs on the host.
The MCP image does not bundle or start the upstream API.

Add the following to LibreChat's configuration, not this repository's MCP runtime:

```yaml
mcpSettings:
  allowedAddresses:
    - 'fantasy-mcp:3001'
mcpServers:
  fantasy-football:
    type: streamable-http
    url: http://fantasy-mcp:3001/mcp
    requiresOAuth: false
    headers:
      Authorization: 'Bearer ${MCP_AUTH_TOKEN}'
    serverInstructions: true
    timeout: 120000
```

Make the same token available in LibreChat's process environment. Current LibreChat
docs support the exact-address allowlist above; check the deployed version, since
older releases may require `mcpSettings.allowedDomains` instead. Explicit
`requiresOAuth: false` is appropriate for this static-token integration, not for a
future OAuth service. CORS is unrelated to this server-to-server connection.

## 9. Security and Stateful Alternatives

Read-only does not mean public: a caller could read private league data and trigger
expensive upstream work. Host/origin validation and authentication serve different
purposes; keep both. All authenticated callers in this proposal share one trusted
league/credential configuration, and tools can currently override league IDs.
If access must be restricted to one league, enforce that at the authenticated
authorization boundary, not through model instructions.

Do not interpret an unverified `X-User-ID` as authorization. For multiple independent
LibreChat users/leagues, authenticate each caller, authorize requested league IDs,
and scope clients/caches by verified identity and credentials. A static service
token intentionally does not provide per-user isolation.

Use stateful HTTP only if later requiring server-initiated notifications, negotiated
client capabilities across requests, sampling/elicitation, or resumable sessions.
Then maintain one server/transport pair per session, initialize using
`sessionIdGenerator: () => randomUUID()`, route subsequent POST/GET/DELETE by
`Mcp-Session-Id`, bind sessions to the authenticated principal, expire idle sessions,
limit session counts and close them on shutdown. Multiple replicas need sticky
routing or a deliberate distributed design; putting session IDs in Redis alone
does not share live transports. Existing read-only handlers need none of this.

## 10. Documentation and Acceptance Tests

Update [README.md](../README.md) and [.env.example](../.env.example) with transport,
host, port, token, host/origin lists, Docker networking and the liveness endpoint.
Never put a real token in the example file. Keep local stdio setup intact.

Add `test/runtime-config.test.js`, `test/http-transport.test.js`, and a registration
cache regression test. Use the existing Node test runner, `node:http`, `fetch`, and
a mocked API client; Supertest is optional rather than a required dependency.

Acceptance checks:

1. Existing `npm test` passes after the SDK upgrade and after each refactor step.
2. Factory imports have no startup side effects; both transports list identical
   tools, resources and prompts, and return the existing server instructions.
3. A real HTTP initialize request succeeds; notifications return 202; subsequent
   list/call requests carry the negotiated `MCP-Protocol-Version`. Requests include
   `Content-Type: application/json` and `Accept: application/json, text/event-stream`.
4. Concurrent HTTP clients with overlapping JSON-RPC request IDs receive isolated
   responses; injury-report caching persists across separate request factories.
5. Missing/wrong token returns 401; invalid Host or Origin returns 403; malformed
   or oversized JSON returns 400/413; GET/DELETE `/mcp` returns 405.
6. Response finish/disconnect and SIGTERM clean up without dangling connections;
   shutdown drains slow tool calls up to its deadline and rejects new connections.
7. A stdio child process initializes without non-JSON diagnostics on stdout.
8. `docker build` and a runtime-configured container pass `/healthz`; LibreChat can
   initialize and call a tool through the shared Docker network, and the upstream
   API remains reachable by its service DNS name.

## References

- [SDK v2 documentation](https://ts.sdk.modelcontextprotocol.io/v2/)
- [Node transport source and API examples](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/middleware/node/src/streamableHttp.ts)
- [Express app helper and host/origin options](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/middleware/express/src/express.ts)
- [Published Node adapter metadata](https://registry.npmjs.org/@modelcontextprotocol%2fnode/latest)
- [LibreChat MCP server configuration](https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/mcp_servers)

The API shapes above were checked against SDK v2 source and published adapter
metadata. Validate installed exports and the stdio smoke test after resolving the
proposed versions; documentation on a moving main branch can advance ahead of
published releases.