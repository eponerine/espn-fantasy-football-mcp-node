import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildRosterDetails } from '../recap/payload.js';

const fixture = JSON.parse(await readFile(new URL('../tests/fixtures/recap_w7.json', import.meta.url), 'utf8'));

test('A5 dropped recap-week players use known next-week NFL byes without joining another player points', () => {
  const captured = fixture.team_lineups[0].starters[0];
  const current = { ...captured, lineup_slot: 'QB', pro_team: 'BUF' };
  const next = { ...captured, player_id: 999999, lineup_slot: 'BE', pro_team: 'BUF', on_bye_week: true };
  const result = buildRosterDetails({ teams: [fixture.teams[0]], week: 7,
    injuries_as_of: fixture.meta.generated_at, lineupSlots: [{ slot: 'QB', type: 'START', count: 1 }],
    currentPlayersByTeam: new Map([[fixture.teams[0].team_id, [current]]]),
    rostersByTeam: new Map([[fixture.teams[0].team_id, [next]]]) });
  const player = result.team_lineups[0].starters[0];
  assert.equal(player.is_bye_next_week, true);
  assert.equal(player.player_id, captured.player_id);
  assert.equal(player.points, captured.points);
});