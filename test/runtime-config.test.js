import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRuntimeConfig } from '../src/runtime-config.js';

test('runtime defaults preserve local stdio', () => {
  const config = loadRuntimeConfig({}, []);
  assert.equal(config.transport, 'stdio');
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3001);
});

test('CLI takes precedence over environment configuration', () => {
  const config = loadRuntimeConfig({ MCP_TRANSPORT: 'streamable-http', MCP_PORT: '3001' },
    ['--transport=stdio', '--port', '4000', '--host=localhost']);
  assert.equal(config.transport, 'stdio');
  assert.equal(config.port, 4000);
  assert.equal(config.host, 'localhost');
});

test('HTTP requires explicit authentication and host validation', () => {
  assert.throws(() => loadRuntimeConfig({ MCP_TRANSPORT: 'streamable-http' }, []), /HTTP requires/);
  const config = loadRuntimeConfig({ MCP_TRANSPORT: 'streamable-http', MCP_AUTH_TOKEN: 'test-token',
    MCP_ALLOWED_HOSTS: 'fantasy-mcp, localhost', MCP_ALLOWED_ORIGINS: 'chat.example.com' }, []);
  assert.deepEqual(config.allowedHosts, ['fantasy-mcp', 'localhost']);
  assert.deepEqual(config.allowedOrigins, ['chat.example.com']);
});

test('runtime rejects unsupported transports, ports, limits and unknown arguments', () => {
  assert.throws(() => loadRuntimeConfig({}, ['--transport=sse']), /Unsupported/);
  for (const port of ['0', '65536', '1.2', 'not-a-port']) {
    assert.throws(() => loadRuntimeConfig({ MCP_PORT: port }, []), /MCP_PORT/);
  }
  assert.throws(() => loadRuntimeConfig({ MCP_MAX_CONCURRENT_REQUESTS: '0' }, []), /MCP_MAX/);
  assert.throws(() => loadRuntimeConfig({ MCP_SHUTDOWN_TIMEOUT_MS: '-1' }, []), /MCP_SHUTDOWN/);
  assert.throws(() => loadRuntimeConfig({}, ['--unknown']), /Unknown option/);
});