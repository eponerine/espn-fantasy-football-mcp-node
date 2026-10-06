import { timingSafeEqual } from 'node:crypto';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';

export function createHttpApp(createServer, config) {
  if (!config.token || !config.allowedHosts?.length) {
    throw new Error('HTTP requires MCP_AUTH_TOKEN and MCP_ALLOWED_HOSTS');
  }
  const app = createMcpExpressApp({
    host: config.host,
    allowedHosts: config.allowedHosts,
    allowedOrigins: config.allowedOrigins ?? [],
    jsonLimit: '1mb'
  });
  const activeServers = new Set();
  const expectedToken = Buffer.from(`Bearer ${config.token}`);
  let draining = false;
  app.disable('x-powered-by');
  app.get('/healthz', (_request, response) => {
    response.status(draining ? 503 : 200).json({ status: draining ? 'draining' : 'ok' });
  });
  app.use('/mcp', (request, response, next) => {
    const actualToken = Buffer.from(request.get('authorization') ?? '');
    if (actualToken.length !== expectedToken.length || !timingSafeEqual(actualToken, expectedToken)) {
      return response.status(401).json({ error: 'Unauthorized' });
    }
    if (draining || activeServers.size >= config.maxConcurrentRequests) {
      return response.set('Retry-After', '1').status(503).json({ error: 'Service unavailable' });
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
      void server.close().catch(() => console.error('MCP request cleanup failed'));
    };
    response.once('finish', cleanup);
    response.once('close', cleanup);
    try {
      await server.connect(transport);
      if (closed) {
        await server.close();
        return;
      }
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      cleanup();
      next(error);
    }
  });
  app.all('/mcp', (_request, response) => response.set('Allow', 'POST').status(405).end());
  app.use((error, _request, response, next) => {
    if (response.headersSent) return next(error);
    const status = error.type === 'entity.too.large' ? 413 :
      error.type === 'entity.parse.failed' ? 400 : 500;
    if (status === 500) console.error('MCP HTTP request failed');
    response.status(status).json({ error: status === 500 ? 'Internal server error' : 'Invalid body' });
  });
  return { app, activeServers, beginDrain: () => { draining = true; } };
}

export async function startHttp(createServer, config) {
  const { app, activeServers, beginDrain } = createHttpApp(createServer, config);
  const httpServer = await new Promise((resolve, reject) => {
    const listener = app.listen(config.port, config.host, () => {
      listener.off('error', reject);
      resolve(listener);
    });
    listener.once('error', reject);
  });
  let closing;
  httpServer.on('request', (_request, response) => {
    response.once('finish', () => {
      if (closing) setImmediate(() => httpServer.closeIdleConnections());
    });
  });
  function close() {
    if (closing) return closing;
    beginDrain();
    closing = new Promise((resolve, reject) => {
      let forced = false;
      const deadline = setTimeout(() => {
        forced = true;
        void Promise.allSettled([...activeServers].map(server => server.close()));
        httpServer.closeAllConnections();
      }, config.shutdownTimeoutMs);
      httpServer.close(error => {
        clearTimeout(deadline);
        if (error) reject(error);
        else resolve({ forced });
      });
      httpServer.closeIdleConnections();
    });
    return closing;
  }
  return { httpServer, close, activeServers };
}