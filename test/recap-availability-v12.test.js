import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildAvailability } from '../recap/availability.js';

const injuriesAsOf = '2026-10-28T16:31:23.856Z';
const qbSlot = { slot: 'QB', type: 'START', count: 1 };
const player = (playerId, overrides = {}) => ({
  player_id: playerId, name: `Player ${playerId}`, position: 'QB',
  lineup_slot: 'QB', pro_team: 'BUF', injury_status: 'ACTIVE', ...overrides
});

function availability(roster, options = {}) {
  return buildAvailability({
    teams: [{ team_id: 1, team_name: 'Team One' }],
    rostersByTeam: new Map([[1, roster]]),
    priorWeekPlayersByTeam: new Map([[1, [{ player_id: 1, points: 0 }]]]),
    lineupSlots: [qbSlot], injuries_as_of: injuriesAsOf, roster_week: 8, ...options
  });
}

test('availability labels the injury snapshot, roster week and legacy slot alias', () => {
  const result = availability([player(1, { injury_status: 'OUT' })]);
  assert.equal(result.injuries_as_of, injuriesAsOf);
  assert.equal(result.roster_week, 8);
  assert.equal(result.metadata.slot_alias, 'next_week_slot');
  assert.match(result.metadata.slot_semantics, /roster snapshot/);
  assert.match(result.metadata.slot_semantics, /not final next-week/);
  const injury = result.teams[0].injuries[0];
  assert.equal(injury.slot, injury.next_week_slot);
  assert.equal(injury.week_points, 0);
});

test('default snapshot timestamp is current and an unknown roster week stays null', () => {
  const before = Date.now();
  const result = availability([], { injuries_as_of: undefined, roster_week: undefined });
  assert.ok(Date.parse(result.injuries_as_of) >= before);
  assert.ok(Date.parse(result.injuries_as_of) <= Date.now());
  assert.equal(result.roster_week, null);
});

test('healthy and questionable starters without cover are not actionable gaps', () => {
  for (const injury_status of ['ACTIVE', 'QUESTIONABLE', 'DOUBTFUL', 'DAY_TO_DAY']) {
    const result = availability([player(1, { injury_status })]);
    assert.deepEqual(result.teams[0].gaps, []);
    assert.equal(result.teams[0].flags.starter_without_healthy_bench_cover, false);
  }
});

test('bye and OUT starters without cover are actionable gaps', () => {
  for (const [overrides, reason] of [[{ on_bye_week: true }, 'BYE'], [{ injury_status: 'out' }, 'OUT']]) {
    const team = availability([player(1, overrides)]).teams[0];
    assert.equal(team.gaps.length, 1);
    assert.equal(team.gaps[0].starters_on_bye_or_out[0].reason, reason);
    assert.equal(team.gaps[0].starter_without_healthy_bench_cover, true);
    assert.equal(team.flags.starter_without_healthy_bench_cover, true);
  }
});

test('eligible healthy bench cover removes bye and OUT gaps', () => {
  for (const overrides of [{ on_bye_week: true }, { injury_status: 'OUT' }]) {
    const roster = [player(1, overrides), player(2, { lineup_slot: 'BE' })];
    assert.deepEqual(availability(roster).teams[0].gaps, []);
    const detail = availability(roster, { include_gap_detail: true }).teams[0].gaps[0];
    assert.equal(detail.starters_on_bye_or_out.length, 1);
    assert.deepEqual(detail.healthy_bench_eligible.map((row) => row.player_id), [2]);
    assert.equal(detail.starter_without_healthy_bench_cover, false);
  }
});

test('bye, OUT, IR, and ineligible bench players do not count as cover', () => {
  for (const overrides of [
    { on_bye_week: true }, { injury_status: 'OUT' }, { injury_status: 'INJURY_RESERVE' },
    { lineup_slot: 'IR' }, { position: 'WR' }
  ]) {
    const team = availability([
      player(1, { injury_status: 'OUT' }), player(2, { lineup_slot: 'BE', ...overrides })
    ]).teams[0];
    assert.equal(team.gaps[0].starter_without_healthy_bench_cover, true);
    assert.deepEqual(team.gaps[0].healthy_bench_eligible, []);
  }
});

test('empty and partially empty required slots are gaps even with bench cover', () => {
  for (const roster of [[], [player(2, { lineup_slot: 'BE' })], [player(1)]]) {
    const team = availability(roster, { lineupSlots: [{ ...qbSlot, count: 2 }] }).teams[0];
    assert.equal(team.gaps[0].empty_slots, roster.some((row) => row.lineup_slot === 'QB') ? 1 : 2);
    assert.equal(team.flags.starter_without_healthy_bench_cover, false);
  }
});

test('detail mode keeps every starting slot without changing actionable flags', () => {
  const lineupSlots = [qbSlot, { slot: 'BE', type: 'BENCH', count: 5 }, { slot: 'IR', type: 'IR', count: 1 }];
  const roster = [player(1)];
  const summary = availability(roster, { lineupSlots });
  const detailed = availability(roster, { lineupSlots, include_gap_detail: true });
  assert.deepEqual(summary.teams[0].gaps, []);
  assert.deepEqual(detailed.teams[0].gaps.map((gap) => gap.slot), ['QB']);
  assert.equal(detailed.teams[0].gaps[0].empty_slots, 0);
  assert.deepEqual(summary.teams[0].flags, detailed.teams[0].flags);
});

test('FLEX cover honors explicit eligibility and the existing default positions', () => {
  const roster = [player(1, { lineup_slot: 'FLEX', injury_status: 'OUT' }),
    player(2, { lineup_slot: 'BE', position: 'WR' })];
  const slot = { slot: 'FLEX', type: 'FLEX', count: 1 };
  assert.deepEqual(availability(roster, { lineupSlots: [slot] }).teams[0].gaps, []);
  const restricted = availability(roster, { lineupSlots: [{ ...slot, eligible_positions: ['RB'] }] });
  assert.equal(restricted.teams[0].gaps.length, 1);
});

test('missing rosters, slot_position fallback, sentinel teams and team-specific points remain supported', () => {
  const roster = [player(1, { lineup_slot: undefined, slot_position: 'QB', injury_status: 'OUT' }),
    player(2, { pro_team: ' None ', on_bye_week: true, injury_status: 'OUT' })];
  const result = availability(roster, { teams: [{ team_id: 1 }, { team_id: 2 }] });
  assert.deepEqual(result.bye_teams, []);
  assert.deepEqual(result.teams[0].injuries.map((row) => [row.player_id, row.next_week_slot, row.week_points]), [[1, 'QB', 0]]);
  assert.deepEqual(result.teams[1].injuries, []);
  assert.equal(result.teams[1].gaps[0].empty_slots, 1);
});

test('Week 7 fixture availability preserves sanitized data, aliases, weekly points and source bytes', async () => {
  const fixtureUrl = new URL('../tests/fixtures/recap_w7.json', import.meta.url);
  const original = await readFile(fixtureUrl, 'utf8');
  const fixture = JSON.parse(original);
  const snapshot = structuredClone(fixture);
  const rostersByTeam = new Map(fixture.injuries_and_byes.teams.map((team) => {
    const rows = [...team.byes, ...team.injuries, ...team.ir_players];
    return [team.team_id, [...new Map(rows.map((row) => [row.player_id, {
      ...row, name: row.player, lineup_slot: row.next_week_slot,
      on_bye_week: team.byes.some((bye) => bye.player_id === row.player_id)
    }])).values()]];
  }));
  const result = buildAvailability({
    teams: fixture.teams, rostersByTeam,
    priorWeekPlayersByTeam: new Map(fixture.team_lineups.map((team) => [team.team_id,
      [...team.starters, ...team.bench, ...team.ir]])),
    lineupSlots: [], injuries_as_of: fixture.meta.generated_at,
    roster_week: fixture.injuries_and_byes.slot_week
  });
  assert.equal(result.roster_week, 8);
  assert.equal(result.injuries_as_of, fixture.meta.generated_at);
  assert.deepEqual(result.bye_teams, fixture.injuries_and_byes.bye_teams);
  for (const team of result.teams) {
    const source = fixture.injuries_and_byes.teams.find((row) => row.team_id === team.team_id);
    for (const section of ['byes', 'injuries', 'ir_players']) {
      const byPlayerId = (left, right) => left.player_id - right.player_id;
      assert.deepEqual([...team[section]].sort(byPlayerId), [...source[section]].sort(byPlayerId));
    }
  }
  for (const team of fixture.teams) assert.equal(team.owner_name, `owner_${team.team_id}`);
  assert.deepEqual(fixture, snapshot);
  assert.equal(await readFile(fixtureUrl, 'utf8'), original);
});

test('A4 a null pro team never creates a bye or a bye gap', () => {
  const result = availability([player(1, { pro_team: null, on_bye_week: true })]);
  assert.deepEqual(result.bye_teams, []);
  assert.deepEqual(result.teams[0].byes, []);
  assert.deepEqual(result.teams[0].gaps, []);
});