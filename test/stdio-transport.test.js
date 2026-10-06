import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('stdio entrypoint initializes and lists all registrations with JSON-only stdout', { timeout: 5000 }, async context => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/index.js', import.meta.url)), '--transport=stdio'],
    { env: { ...process.env, MCP_TRANSPORT: 'streamable-http', MCP_PORT: '3001' }, stdio: ['pipe', 'pipe', 'pipe'] });
  context.after(() => { if (child.exitCode === null) child.kill(); });
  const exited = once(child, 'exit');
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const reader = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  async function request(id, method, params) {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    const { value, done } = await reader.next();
    assert.equal(done, false, stderr);
    const message = JSON.parse(value);
    assert.equal(message.id, id);
    assert.equal(message.error, undefined);
    return message.result;
  }
  const initialized = await request(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {},
    clientInfo: { name: 'stdio-test', version: '1' } });
  assert.match(initialized.instructions, /Start with get_league_profile/);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  assert.ok((await request(2, 'tools/list')).tools.some(tool => tool.name === 'get_injury_report'));
  assert.ok((await request(3, 'resources/list')).resources.some(resource => resource.uri === 'fantasy://league/current'));
  assert.ok((await request(4, 'prompts/list')).prompts.some(prompt => prompt.name === 'start-sit'));
  child.stdin.end();
  assert.equal((await exited)[0], 0);
  assert.match(stderr, /on stdio/);
});