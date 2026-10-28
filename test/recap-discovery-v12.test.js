import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { SCHEMA_VERSION } from '../recap/payload.js';
import { getRecapSchema, recapSchema } from '../recap/schema.js';
import { createServer } from '../src/server.js';

async function connect(context) {
  const server = createServer({ client: { get() { throw new Error('Discovery must not fetch upstream data.'); } } });
  const probe = server.registerTool('discovery_probe', {
    description: 'Initial discovery probe', inputSchema: z.object({})
  }, async () => ({ content: [] }));
  const [transport, serverTransport] = InMemoryTransport.createLinkedPair();
  const pending = new Map();
  const notifications = [];
  let nextId = 0;
  let onNotification;
  transport.onmessage = message => {
    if (message.id !== undefined) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    } else {
      notifications.push(message);
      onNotification?.(message);
    }
  };
  context.after(() => server.close());
  await server.connect(serverTransport);
  await transport.start();
  async function request(method, params = {}) {
    const id = ++nextId;
    const result = Promise.withResolvers();
    pending.set(id, result);
    await transport.send({ jsonrpc: '2.0', id, method, params });
    return result.promise;
  }
  const initialized = await request('initialize', {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'recap-discovery-test', version: '1' }
  });
  await transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return { request, initialized, notifications, probe,
    onNotification(callback) { onNotification = callback; } };
}

test('tools/list exposes recap 1.2 controls and get_recap_schema over MCP', { timeout: 5000 }, async context => {
  const connection = await connect(context);
  const { tools } = await connection.request('tools/list');
  const recap = tools.find(tool => tool.name === 'get_recap_data');
  assert.ok(recap);
  for (const [name, defaultValue] of Object.entries({
    include_history: true, include_gap_detail: false, include_optimal_assignment: true
  })) {
    assert.equal(recap.inputSchema.properties[name].type, 'boolean');
    assert.equal(recap.inputSchema.properties[name].default, defaultValue);
    assert.ok(!recap.inputSchema.required?.includes(name));
  }
  assert.ok(tools.some(tool => tool.name === 'get_recap_schema'));
  assert.match(recap.inputSchema.properties.sections.description, /team_lineups_week.*pending_claims_meta/);
  const result = await connection.request('tools/call', { name: 'get_recap_schema', arguments: {} });
  assert.notEqual(result.isError, true);
  const schema = JSON.parse(result.content.find(part => part.type === 'text').text);
  assert.deepEqual(schema, getRecapSchema());
  assert.equal(schema.properties.schema_version.const, SCHEMA_VERSION);
  assert.match(schema.description, /Recap 1\.2\.0/);
  assert.deepEqual(connection.notifications, []);
});

test('SDK emits tools/list_changed on definition update and tools/list returns the update', { timeout: 5000 }, async context => {
  const connection = await connect(context);
  assert.equal(connection.initialized.capabilities.tools.listChanged, true);
  await connection.request('tools/list');
  assert.deepEqual(connection.notifications, []);
  const notification = Promise.withResolvers();
  connection.onNotification(notification.resolve);
  connection.probe.update({
    description: 'Updated discovery probe',
    paramsSchema: z.object({ include_history: z.boolean().default(true) })
  });
  assert.equal((await notification.promise).method, 'notifications/tools/list_changed');
  const { tools } = await connection.request('tools/list');
  const probe = tools.find(tool => tool.name === 'discovery_probe');
  assert.equal(probe.description, 'Updated discovery probe');
  assert.equal(probe.inputSchema.properties.include_history.default, true);
  assert.equal(connection.notifications.length, 1);
});

test('stdio initialization advertises tools.listChanged and immediately serves tools/list', { timeout: 5000 }, async context => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/index.js', import.meta.url)), '--transport=stdio'],
    { env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });
  context.after(() => { if (child.exitCode === null) child.kill(); });
  const exited = once(child, 'exit');
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const reader = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  async function request(id, method, params = {}) {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    const { value, done } = await reader.next();
    assert.equal(done, false, stderr);
    const message = JSON.parse(value);
    assert.equal(message.id, id, 'No unsolicited startup notification should precede the response.');
    assert.equal(message.error, undefined);
    return message.result;
  }
  const initialized = await request(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {},
    clientInfo: { name: 'recap-stdio-discovery-test', version: '1' } });
  assert.equal(initialized.capabilities.tools.listChanged, true);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const { tools } = await request(2, 'tools/list');
  assert.equal(tools.find(tool => tool.name === 'get_recap_data').inputSchema.properties.include_gap_detail.default, false);
  assert.ok(tools.some(tool => tool.name === 'get_recap_schema'));
  child.stdin.end();
  assert.equal((await exited)[0], 0, stderr);
});

test('schema accepts explicit nulls and compact omissions while requiring lineup totals and bye flags', () => {
  const lineup = recapSchema.shape.team_lineups.unwrap().element;
  const player = {
    player_id: 1, name: 'Player One', position: 'QB', slot: 'QB', points: 0, projected_points: null,
    pro_team: null, injury_status: null, is_bye_next_week: false, percent_rostered: null
  };
  const row = { team_id: 1, roster_week: 7, starters_total: 0, bench_total: 0, starters: [player], bench: [], ir: [] };
  assert.equal(lineup.safeParse(row).success, true);
  for (const field of ['pro_team', 'injury_status', 'is_bye_next_week', 'percent_rostered']) {
    const incomplete = structuredClone(row);
    delete incomplete.starters[0][field];
    assert.equal(lineup.safeParse(incomplete).success, field !== 'is_bye_next_week', field);
  }
  for (const field of ['roster_week', 'starters_total', 'bench_total']) {
    const incomplete = structuredClone(row);
    delete incomplete[field];
    assert.equal(lineup.safeParse(incomplete).success, false, field);
  }
});

test('schema describes section metadata and requires valid injury snapshot timestamps', () => {
  const schema = getRecapSchema();
  assert.equal(schema.properties.team_lineups_week.type, 'integer');
  assert.deepEqual(schema.properties.pending_claims_meta.required, ['scoring_period', 'transaction_types_checked', 'source_count']);
  assert.equal(recapSchema.shape.pending_claims_meta.safeParse({
    scoring_period: 8, transaction_types_checked: ['WAIVER', 'FREEAGENT'], source_count: 0
  }).success, true);
  const watch = recapSchema.shape.injury_watch.unwrap().element;
  const row = { team_id: 1, player_id: 1, name: 'Player One', position: 'QB',
    injuries_as_of: '2026-10-28T16:31:23.856Z', roster_week: 8, matched_criteria: ['next_week_starter'] };
  assert.equal(watch.safeParse(row).success, true);
  assert.equal(watch.safeParse({ ...row, injuries_as_of: 'not-a-timestamp' }).success, false);
  const availability = recapSchema.shape.injuries_and_byes.unwrap();
  const snapshot = { injuries_as_of: row.injuries_as_of, roster_week: 8,
    metadata: { slot_alias: 'next_week_slot', slot_semantics: 'Roster snapshot, not final next-week lineups.' }, bye_teams: [], teams: [] };
  assert.equal(availability.safeParse(snapshot).success, true);
  assert.equal(availability.safeParse({ ...snapshot, injuries_as_of: undefined }).success, false);
  assert.match(schema.description, /team_lineups_week with team_lineups.*pending_claims_meta with pending_claims/);
});

test('schema documents independent swaps, assignment alias, ranking sign and preview names', () => {
  const schema = getRecapSchema();
  const bench = schema.properties.bench_analysis.properties.teams.items.properties;
  assert.match(bench.optimal_assignment.description, /optimal lineup/);
  assert.match(bench.assignment.description, /Deprecated alias/);
  assert.match(bench.swaps.description, /Independent.*not a simultaneous plan/);
  assert.match(schema.properties.power_rankings.items.properties.diff_vs_espn.description, /espn_rank - rank; positive.*higher/);
  assert.match(schema.properties.preview.description, /player-name arrays and open_ir_slots/);
  assert.match(schema.properties.injuries_and_byes.properties.metadata.properties.slot_semantics.description, /not final next-week/);
});