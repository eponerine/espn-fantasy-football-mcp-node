import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const fixture = JSON.parse(await readFile(new URL('../tests/fixtures/recap_w7.json', import.meta.url), 'utf8'));
const { settings } = JSON.parse(await readFile(new URL('../tests/fixtures/settings.json', import.meta.url), 'utf8'));

test('A6 recap pending fetch matches direct scoringPeriod=8 transactions and rejects missing sources', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recap-pending-'));
  const previous = process.env.RECAP_TEAM_NAME_CACHE;
  process.env.RECAP_TEAM_NAME_CACHE = join(directory, 'snapshots.json');
  try {
    const { createRecapHandler } = await import('../src/tools/recap-tools.js');
    const pending = { transactions: [
      { team_id: 1, type: 'WAIVER', status: 'PENDING', scoring_period: 8 },
      { team_id: 2, type: 'FREEAGENT', status: 'CANCELED', scoring_period: 8 },
      { team_id: 3, type: 'TRADE', status: 'PENDING', scoring_period: 8 }
    ] };
    const calls = [];
    let response = pending;
    const lineup = (teamId) => {
      const team = fixture.team_lineups.find(row => row.team_id === teamId);
      return [...team.starters, ...team.bench, ...team.ir].map(player => ({ ...player, slot_position: player.slot }));
    };
    const client = { get: async (path, params = {}) => {
      calls.push({ path, params });
      if (path === '/league') return { league_id: 380348, year: 2026, current_week: 8 };
      if (path === '/settings') return { settings };
      if (path === '/teams') return { teams: fixture.teams };
      if (path === '/box-scores') return { box_scores: params.week !== 7 ? [] : fixture.scoreboard.map(game => ({
        ...game, home_lineup: lineup(game.home_team_id), away_lineup: lineup(game.away_team_id)
      })) };
      if (path === '/roster') return { team_id: params.teamId, roster: [] };
      if (path === '/power-rankings') return { rankings: [] };
      if (path === '/transactions') {
        if (params.scoringPeriod !== 8) return { transactions: [] };
        if (response instanceof Error) throw response;
        return response;
      }
      throw new Error(`Unexpected path ${path}`);
    } };
    const direct = await client.get('/transactions', { scoringPeriod: 8 });
    calls.length = 0;
    const handler = createRecapHandler(client);
    const recap = await handler({ week: 7, include_preview: false });
    assert.deepEqual(recap.pending_claims, direct.transactions.slice(0, 2));
    assert.equal(recap.pending_claims_meta.source_count, direct.transactions.length);
    assert.deepEqual(calls.filter(call => call.path === '/transactions').map(call => call.params.scoringPeriod), [7, 8]);
    response = {};
    await assert.rejects(handler({ week: 7, include_preview: false }), /transactions array/);
    response = new Error('Pending source unavailable');
    await assert.rejects(handler({ week: 7, include_preview: false }), /Pending source unavailable/);
  } finally {
    if (previous == null) delete process.env.RECAP_TEAM_NAME_CACHE;
    else process.env.RECAP_TEAM_NAME_CACHE = previous;
    await rm(directory, { recursive: true, force: true });
  }
});