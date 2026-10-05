import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInjuryReport, classifyInjuryTiming, rankTopPlayers } from '../src/domain/injury-report.js';

function player(id, name, position, totalPoints, extra = {}) {
  return {
    player_id: id,
    name,
    position,
    pro_team: 'KC',
    lineup_slot: position,
    eligible_slots: [position, 'RB/WR/TE', 'BE'],
    injury_status: 'ACTIVE',
    total_points: totalPoints,
    avg_points: totalPoints / 5,
    ...extra
  };
}

function card(weeks) {
  const stats = {};
  const schedule = {};
  for (const [week, line] of Object.entries(weeks)) {
    if (line === 'bye') continue;
    schedule[week] = { team: 'BUF', date: '2026-10-04T17:00:00.000Z' };
    stats[week] = {
      points: line.points,
      projected_points: line.projected,
      breakdown: line.played ? { rushingYards: 10 } : {}
    };
  }
  return { stats, schedule };
}

const ROSTERS = [
  {
    team_id: 1,
    team_name: 'Alpha',
    roster: [
      player(10, 'Star RB', 'RB', 120, { injury_status: 'OUT' }),
      player(11, 'Backup RB', 'RB', 30, { lineup_slot: 'BE' }),
      player(12, 'Hurt Bench RB', 'RB', 25, { lineup_slot: 'BE', injury_status: 'OUT' })
    ]
  },
  {
    team_id: 2,
    team_name: 'Bravo',
    roster: [
      player(20, 'Star WR', 'WR', 110, { injury_status: 'QUESTIONABLE' }),
      player(21, 'Healthy QB', 'QB', 130)
    ]
  },
  { team_id: 3, team_name: 'Charlie', roster: [player(30, 'Solid TE', 'TE', 60)] }
];

test('rankTopPlayers ranks across teams and assigns positional ranks', () => {
  const top = rankTopPlayers(ROSTERS, 3);
  assert.deepEqual(top.map((p) => p.name), ['Healthy QB', 'Star RB', 'Star WR']);
  assert.equal(top[1].team_name, 'Alpha');
  assert.equal(top[1].ytd_position_rank, 1);
});

test('classifyInjuryTiming separates in-game, missed and ongoing injuries', () => {
  const hurtInGame = card({ 3: { played: true, points: 15, projected: 14 }, 4: { played: true, points: 15, projected: 14 }, 5: { played: true, points: 2, projected: 14 } });
  assert.equal(classifyInjuryTiming(hurtInGame, 5).timing, 'likely_hurt_in_recap_week_game');

  const missed = card({ 3: { played: true, points: 15 }, 4: 'bye', 5: { played: false } });
  const missedResult = classifyInjuryTiming(missed, 5);
  assert.equal(missedResult.timing, 'missed_recap_week');
  assert.equal(missedResult.is_new_this_week, true);

  const ongoing = card({ 3: { played: true, points: 15 }, 4: { played: false }, 5: { played: false } });
  assert.equal(classifyInjuryTiming(ongoing, 5).timing, 'ongoing_absence');

  assert.equal(classifyInjuryTiming(null, 5).timing, 'unknown');
});

test('buildInjuryReport groups injured top players by team with fill-in options', () => {
  const topPlayers = rankTopPlayers(ROSTERS, 100);
  const report = buildInjuryReport({
    rosters: ROSTERS,
    topPlayers,
    playerCards: new Map([[10, card({ 5: { played: false }, 4: { played: true, points: 20 } })]]),
    recapWeek: 5,
    currentWeek: 6,
    asOf: '2026-10-06T12:00:00.000Z'
  });

  assert.equal(report.injured_count, 3);
  const alpha = report.by_team.find((t) => t.team_id === 1);
  const starFill = alpha.positions_to_fill.find((f) => f.injured_player === 'Star RB');
  assert.equal(starFill.currently_in_lineup, true);
  assert.deepEqual(starFill.bench_options.map((o) => o.name), ['Backup RB']);

  const bravo = report.by_team.find((t) => t.team_id === 2);
  assert.equal(bravo.positions_to_fill[0].needs_waiver_help, true);
  assert.deepEqual(report.healthy_teams, ['Charlie']);

  const starWr = report.injured_players.find((p) => p.name === 'Star WR');
  assert.equal(starWr.injury_timing, 'unknown');
  assert.ok(starWr.note);
});
