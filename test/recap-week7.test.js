import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { recapSchema } from '../recap/schema.js';
import { selectRecapSections } from '../recap/payload.js';
import { asCurrentVersion } from './helpers/recap-fixture-migration.js';

let fixture;
try {
  fixture = JSON.parse(await readFile(new URL('../tests/fixtures/recap_w7.json', import.meta.url), 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const options = { skip: fixture ? false : 'Week 7 capture requires local ESPN_S2 and SWID; run scripts/capture-recap-fixture.js.' };

test('Week 7 fixture has the requested scope, sanitized owners and versioned schema', options, () => {
  assert.deepEqual([fixture.meta.league_id, fixture.meta.season, fixture.meta.week], [380348, 2026, 7]);
  assert.equal(recapSchema.safeParse(asCurrentVersion(fixture)).success, true);
  for (const team of fixture.teams) {
    assert.equal(team.owner_name, `owner_${team.team_id}`);
    assert.equal(team.display_name, team.name.trim());
  }
  assert.equal(recapSchema.safeParse(asCurrentVersion(selectRecapSections(fixture, { sections: ['team_lineups'], compact: true }))).success, true);
});

test('Week 7 scoreboard, preview and availability references reconcile', options, () => {
  const standings = new Map(fixture.standings.map((row) => [row.team_id, row]));
  for (const game of fixture.scoreboard) {
    assert.equal(game.home_rank, standings.get(game.home_team_id).rank);
    assert.equal(game.away_rank, standings.get(game.away_team_id).rank);
  }
  for (const game of fixture.preview) for (const team of game.teams) assert.deepEqual(team.availability, { team_id: team.team_id });
  assert.equal(fixture.injuries_and_byes.slot_week, 8);
  assert.equal(fixture.injuries_and_byes.week_points_week, 7);
  assert.ok(!fixture.injuries_and_byes.bye_teams.includes('None'));
  for (const team of fixture.injuries_and_byes.teams) for (const player of [...team.byes, ...team.injuries, ...team.ir_players]) {
    assert.notEqual(player.pro_team, 'None');
    assert.equal(player.next_week_slot, player.slot);
  }
});

test('Week 7 actual starters reconcile to scores and injury watch obeys inclusion rules', options, () => {
  for (const game of fixture.scoreboard) for (const side of ['home', 'away']) {
    const lineup = fixture.team_lineups.find((row) => row.team_id === game[`${side}_team_id`]);
    const points = lineup.starters.reduce((sum, row) => sum + Math.round(row.points * 100), 0);
    assert.equal(points, Math.round(game[`${side}_score`] * 100));
    assert.ok(lineup.bench.every((row) => row.slot === 'BE'));
  }
  for (const player of fixture.injury_watch) {
    assert.ok(player.matched_criteria.length);
    assert.ok(player.season_points_rank > 0 && player.season_points_rank <= 150
      || player.percent_rostered >= 60 || !['BE', 'IR', null].includes(player.next_week_slot));
  }
});

test('Week 7 bid totals, failure outcomes, acquisition orders and pending periods are explicit', options, () => {
  for (const war of fixture.roster_moves.bidding_wars) {
    assert.equal(war.bid_count, war.bids.length);
    assert.equal(war.total_bid_amount, war.total_bids);
    assert.equal(war.total_bid_amount, war.bids.reduce((sum, bid) => sum + bid.bid, 0));
  }
  for (const team of fixture.roster_moves.teams) {
    for (const failed of team.failed_bids) assert.ok(failed.reason && failed.outcome);
    for (const claim of team.executed_claims) {
      assert.ok(claim.acquired_order >= 1);
      if (claim.week_points != null) {
        const lineup = fixture.team_lineups.find((row) => row.team_id === team.team_id);
        const player = [...lineup.starters, ...lineup.bench, ...lineup.ir].find((row) => row.player_id === claim.player_id);
        assert.equal(claim.week_points, player.points);
      }
    }
  }
  for (const claim of fixture.pending_claims) {
    assert.equal(claim.scoring_period, 8);
    assert.ok(['PENDING', 'CANCELED', 'CANCELLED'].includes(claim.status));
    assert.ok(['WAIVER', 'FREEAGENT'].includes(claim.type));
  }
});