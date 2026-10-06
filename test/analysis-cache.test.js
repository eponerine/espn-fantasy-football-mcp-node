import assert from 'node:assert/strict';
import test from 'node:test';
import { registerAnalysisTools } from '../src/tools/analysis-tools.js';

function handlers(client, cache) {
  const tools = new Map();
  registerAnalysisTools({ registerTool: (name, _metadata, handler) => tools.set(name, handler) },
    client, { injuryReportCache: cache });
  return tools;
}

test('injury report cache survives registration and resolves default league scope', async () => {
  let calls = 0;
  const client = { defaults: { leagueId: 123, year: 2026 }, get: async path => {
    calls++;
    if (path === '/league') return { current_week: 5 };
    if (path === '/teams') return { teams: [] };
    throw new Error(`Unexpected path ${path}`);
  } };
  const cache = new Map();
  const first = await handlers(client, cache).get('get_injury_report')({ week: 5 });
  assert.equal(first.isError, undefined);
  const second = await handlers(client, cache).get('get_injury_report')({ leagueId: 123, year: 2026, week: 5 });
  assert.equal(JSON.parse(second.content[0].text).served_from_cache, true);
  assert.equal(calls, 2);
  await handlers(client, cache).get('get_injury_report')({ week: 5, refresh: true });
  assert.equal(calls, 4);
});

test('injury cache evicts expired entries and bounds process memory', async () => {
  const cache = new Map(Array.from({ length: 200 }, (_, index) => [String(index),
    { expiresAt: Date.now() + 60000, report: {} }]));
  cache.set('expired', { expiresAt: 0, report: {} });
  const client = { defaults: {}, get: async path => path === '/league' ? { current_week: 5 } : { teams: [] } };
  await handlers(client, cache).get('get_injury_report')({ week: 5 });
  assert.equal(cache.has('expired'), false);
  assert.equal(cache.size, 200);
});