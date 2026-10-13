import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer as createNetServer } from 'node:net';
import { fileURLToPath } from 'node:url';

async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function waitForOutput(stream, pattern, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${pattern}. Output: ${output}`));
    }, timeoutMs);

    function onData(chunk) {
      output += chunk.toString();
      if (pattern.test(output)) {
        cleanup();
        resolve(output);
      }
    }

    function cleanup() {
      clearTimeout(timeout);
      stream.off('data', onData);
    }

    stream.on('data', onData);
  });
}

test('HTTP entrypoint starts on configured host/port with CLI precedence over env, verifies health and auth', { timeout: 10000 }, async context => {
  const port = await getAvailablePort();
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL('../src/index.js', import.meta.url)),
      '--transport', 'streamable-http',
      '--host', '127.0.0.1',
      '--port', String(port)
    ],
    {
      env: {
        ...process.env,
        MCP_TRANSPORT: 'stdio',
        MCP_PORT: '9999',
        MCP_HOST: '127.0.0.9',
        MCP_AUTH_TOKEN: 'entrypoint-test-token',
        MCP_ALLOWED_HOSTS: '127.0.0.1,localhost'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    }
  );
  context.after(() => {
    if (child.exitCode === null) child.kill();
  });

  await waitForOutput(child.stderr, /espn-fantasy-football MCP server on streamable-http/);

  const health = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });

  const unauthorized = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    body: '{}'
  });
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(await unauthorized.json(), { error: 'Unauthorized' });

  const wrongAuth = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { authorization: 'Bearer wrong-token' },
    body: '{}'
  });
  assert.equal(wrongAuth.status, 401);

  const initResponse = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer entrypoint-test-token',
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'entrypoint-tester', version: '1.0' }
      }
    })
  });
  assert.equal(initResponse.status, 200);
  const initResult = await initResponse.json();
  assert.match(initResult.result.instructions, /Start with get_league_profile/);
});

test('HTTP entrypoint fails at startup when required security configuration is missing', { timeout: 5000 }, async () => {
  const env = { ...process.env };
  delete env.MCP_AUTH_TOKEN;
  delete env.MCP_ALLOWED_HOSTS;
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('../src/index.js', import.meta.url)), '--transport=streamable-http'],
    { env, stdio: ['pipe', 'pipe', 'pipe'] }
  );
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 1);
  assert.match(stderr, /HTTP requires MCP_AUTH_TOKEN and MCP_ALLOWED_HOSTS/);
});

test('start-local-http script preserves caller host and port and generates ephemeral token', { timeout: 10000 }, async context => {
  const port = await getAvailablePort();
  const env = { ...process.env };
  delete env.MCP_AUTH_TOKEN;
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL('../scripts/start-local-http.js', import.meta.url)),
      '--port', String(port)
    ],
    { env, stdio: ['pipe', 'pipe', 'pipe'] }
  );
  context.after(() => {
    if (child.exitCode === null) child.kill();
  });

  const stderr = await waitForOutput(child.stderr, /espn-fantasy-football MCP server on streamable-http/);
  assert.match(stderr, /Using an ephemeral local token/);

  const health = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
});
