import assert from 'node:assert/strict';
import test from 'node:test';
import { request as httpRequest } from 'node:http';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createServer } from '../src/server.js';
import { startHttp } from '../src/transports/http.js';

const config = {
  host: '127.0.0.1', port: 0,
  token: 'test-token', allowedHosts: ['127.0.0.1'], allowedOrigins: [],
  shutdownTimeoutMs: 1000, maxConcurrentRequests: 16
};

async function fixture(context, overrides = {}, client = { defaults: {}, get: async () => ({ healthy: true }) }) {
  const injuryReportCache = new Map();
  const service = await startHttp(() => createServer({ client, injuryReportCache }), { ...config, ...overrides });
  context.after(() => service.close());
  const base = `http://127.0.0.1:${service.httpServer.address().port}`;
  function request(body, options = {}) {
    const { headers, ...rest } = options;
    return fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json',
        accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      ...rest
    });
  }
  return { ...service, base, request };
}

test('stateless HTTP initializes and exposes tools, prompts, resources and instructions', async context => {
  const { request, activeServers } = await fixture(context);
  const response = await request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' }
  } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('mcp-session-id'), null);
  const initialized = await response.json();
  assert.match(initialized.result.instructions, /Start with get_league_profile/);
  const version = initialized.result.protocolVersion;
  const notification = await request({ jsonrpc: '2.0', method: 'notifications/initialized' },
    { headers: { 'mcp-protocol-version': version } });
  assert.equal(notification.status, 202);
  await notification.text();
  for (const [method, key] of [['tools/list', 'tools'], ['resources/list', 'resources'], ['prompts/list', 'prompts']]) {
    const listed = await request({ jsonrpc: '2.0', id: 2, method }, { headers: { 'mcp-protocol-version': version } });
    const body = await listed.json();
    assert.ok(body.result[key].length > 0);
  }
  const called = await request({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_health', arguments: {} } });
  assert.deepEqual(JSON.parse((await called.json()).result.content[0].text), { healthy: true });
  assert.equal(activeServers.size, 0);
});

test('HTTP rejects unauthorized requests, disallowed hosts/origins and invalid bodies', async context => {
  const { request, base } = await fixture(context);
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  for (const authorization of ['', 'Bearer wrong-token']) {
    const response = await request({}, { headers: { authorization } });
    assert.equal(response.status, 401);
    await response.text();
  }
  const hostStatus = await new Promise((resolve, reject) => {
    const outgoing = httpRequest(`${base}/mcp`, { method: 'POST', headers: { host: 'attacker.example' } }, response => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
    });
    outgoing.once('error', reject);
    outgoing.end();
  });
  assert.equal(hostStatus, 403);
  const originResponse = await request({}, { headers: { origin: 'https://attacker.example' } });
  assert.equal(originResponse.status, 403);
  await originResponse.text();
  assert.equal((await request('{')).status, 400);
  assert.equal((await request(JSON.stringify({ text: 'x'.repeat(1024 * 1024) }))).status, 413);
  for (const method of ['GET', 'DELETE', 'PUT']) {
    const response = await fetch(`${base}/mcp`, { method, headers: { authorization: 'Bearer test-token' } });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'POST');
  }
});

test('concurrent HTTP clients with identical request IDs remain isolated', async context => {
  const client = { defaults: {}, get: async (_path, args) => ({ league: args.leagueId }) };
  const { request } = await fixture(context, {}, client);
  const results = await Promise.all([123, 456].map(async leagueId => {
    const response = await request({ jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'get_league', arguments: { leagueId } } });
    return JSON.parse((await response.json()).result.content[0].text);
  }));
  assert.deepEqual(results, [{ league: 123 }, { league: 456 }]);
});

test('shutdown drains an active tool and rejects excess concurrent work', async context => {
  let release;
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const client = { defaults: {}, get: async () => { started(); await blocked; return { healthy: true }; } };
  const { request, close } = await fixture(context, { maxConcurrentRequests: 1 }, client);
  const pending = request({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_health', arguments: {} } });
  await entered;
  const excess = await request({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.equal(excess.status, 503);
  await excess.text();
  const draining = close();
  release();
  const completed = await pending;
  assert.equal(completed.status, 200);
  await completed.json();
  assert.equal((await draining).forced, false);
});

test('initialization and subsequent requests can reach different replicas', async context => {
  const first = await fixture(context);
  const second = await fixture(context);
  const initialized = await first.request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'load-balancer', version: '1' }
  } });
  const version = (await initialized.json()).result.protocolVersion;
  const response = await second.request({ jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { headers: { 'mcp-protocol-version': version } });
  assert.ok((await response.json()).result.tools.some(tool => tool.name === 'get_injury_report'));
});

test('disconnected HTTP clients release request state', async context => {
  let entered;
  let release;
  const started = new Promise(resolve => { entered = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const { request, activeServers } = await fixture(context, {}, {
    defaults: {}, get: async () => { entered(); await blocked; return {}; }
  });
  const controller = new AbortController();
  const pending = request({ jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'get_health', arguments: {} } }, { signal: controller.signal });
  const aborted = assert.rejects(pending, { name: 'AbortError' });
  await started;
  controller.abort();
  await aborted;
  release();
  for (let attempt = 0; activeServers.size && attempt < 100; attempt++) await nextTurn();
  assert.equal(activeServers.size, 0);
});

test('shutdown deadline closes remaining connections', async context => {
  let entered;
  let release;
  const started = new Promise(resolve => { entered = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const { request, close } = await fixture(context, { shutdownTimeoutMs: 20 }, {
    defaults: {}, get: async () => { entered(); await blocked; return {}; }
  });
  const pending = request({ jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'get_health', arguments: {} } });
  const disconnected = assert.rejects(pending, /fetch failed/);
  await started;
  const result = await close();
  release();
  assert.equal(result.forced, true);
  await disconnected;
});