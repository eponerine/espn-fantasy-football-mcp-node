import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildRecapData } from '../recap/build.js';
import { solveOptimalLineup } from '../recap/lineups.js';
import { analyzePlayers } from '../recap/players.js';
import { buildRosterDetails, RECAP_SECTIONS, selectRecapSections } from '../recap/payload.js';
import { getRecapSchema, recapSchema } from '../recap/schema.js';
import { summarizeTransactions } from '../recap/transactions.js';
import { buildAvailability } from '../recap/availability.js';
import { calculateWeekScoring } from '../recap/scoring.js';
import { calculateStandings } from '../recap/standings.js';
import { validateRecap } from '../recap/validate.js';
import { registerPrompts } from '../src/prompts/index.js';
import { registerAllTools } from '../src/tools/index.js';

const fixtures = new URL('../tests/fixtures/', import.meta.url);
async function fixture(name) {
  return JSON.parse(await readFile(new URL(name, fixtures), 'utf8'));
}

const recorded = await Promise.all([
  fixture('league.json'),
  fixture('settings.json'),
  fixture('teams.json'),
  ...[1, 2, 3, 4].flatMap((week) => [
    fixture(`box-scores-week-${week}.json`),
    fixture(`scoreboard-week-${week}.json`)
  ]),
  fixture('transactions-week-4.json'),
  fixture('matchups-week-5.json'),
  fixture('power-rankings-week-4.json'),
  fixture('power-rankings-week-3.json'),
  ...Array.from({ length: 12 }, (_, index) => fixture(`roster-week-5-team-${index + 1}.json`))
]);

const [league, settingsPayload, teamsPayload] = recorded;
const teams = teamsPayload.teams;
const boxScoresByWeek = [1, 2, 3, 4].map((week) => recorded[3 + (week - 1) * 2]);
const transactions = recorded[11].transactions;
const previewMatchups = recorded[12].matchups;
const espnPowerRankings = recorded[13];
const espnPriorPowerRankings = recorded[14];
const rosterResponses = recorded.slice(15);

function makeFixtureRecap() {
  return buildRecapData({
    league,
    settings: settingsPayload.settings,
    teams,
    week: 4,
    regularSeason: true,
    boxScoresByWeek,
    rosterResponses,
    transactions,
    previewMatchups,
    espnPowerRankings,
    espnPriorPowerRankings
  });
}

test('recorded weeks 3 and 4 medians and week 4 total reconcile to verified values', () => {
  const recap = makeFixtureRecap();
  assert.equal(recap.week_summary.median, 137.5);
  assert.equal(recap.week_summary.total_points, 1728.25);
  assert.equal(recap.week_summary.average_points, 144.02);
  const week3Scores = boxScoresByWeek[2].box_scores.flatMap((game) => [game.home_score, game.away_score]).sort((a, b) => b - a);
  assert.equal((week3Scores[5] + week3Scores[6]) / 2, 132.75);
  assert.equal(recap.validation.passed, true, JSON.stringify(recap.validation.checks.filter((item) => !item.passed)));
});

test('recorded week 4 standings and all-play order match verified values', () => {
  const recap = makeFixtureRecap();
  const byId = new Map(recap.standings.map((row) => [row.team_id, row]));
  const expected = new Map([
    [8, ['7-1', 560.15, 505.75]], [1, ['6-2', 643.8, 576.6]], [3, ['6-2', 631.15, 484.1]],
    [2, ['6-2', 623.9, 607.5]], [9, ['6-2', 577.3, 520.85]], [4, ['5-3', 581.45, 552.6]],
    [5, ['4-4', 524.15, 577.85]], [11, ['2-6', 540.7, 525.35]], [10, ['2-6', 494, 525.85]],
    [6, ['2-6', 487.75, 600.55]], [7, ['2-6', 456.2, 516.6]], [12, ['0-8', 455.9, 582.85]]
  ]);
  for (const [teamId, [record, pointsFor, pointsAgainst]] of expected) {
    const row = byId.get(teamId);
    assert.deepEqual([row.record, row.points_for, row.points_against], [record, pointsFor, pointsAgainst]);
  }
  assert.deepEqual(recap.power_rankings.map((row) => row.team_id), [1, 2, 3, 4, 9, 8, 5, 11, 6, 10, 7, 12]);
  assert.equal(byId.get(1).all_play.wins, 35);
  assert.equal(byId.get(1).all_play.losses, 9);
  const allPlayExpected = new Map([
    [1, [35, 9]], [2, [33, 11]], [3, [30, 14]], [4, [29, 15]], [9, [28, 16]], [8, [27, 17]],
    [5, [19, 25]], [11, [18, 26]], [6, [14, 30]], [10, [12, 32]], [7, [11, 33]], [12, [8, 36]]
  ]);
  for (const [teamId, expectedRecord] of allPlayExpected) {
    assert.deepEqual([byId.get(teamId).all_play.wins, byId.get(teamId).all_play.losses], expectedRecord);
  }
  assert.ok(Math.abs(byId.get(8).luck_delta - 2.09) < 0.01);
  assert.ok(Math.abs(byId.get(11).luck_delta + 1.27) < 0.01);
  assert.ok(Math.abs(byId.get(12).luck_delta + 1.45) < 0.01);
});

test('recorded week 4 optimal lineups and total bench points match verified values', () => {
  const recap = makeFixtureRecap();
  const expected = new Map([
    [10, [155.5, 52.3]], [9, [179.25, 42.2]], [5, [139.45, 28.6]], [4, [193.25, 26.1]],
    [6, [136.85, 20]], [7, [155.35, 17.4]], [12, [142.25, 10.6]], [8, [153.8, 9.4]],
    [3, [227.6, 7]], [2, [143.55, 4.9]], [1, [190.05, 4.1]], [11, [137.05, 3.1]]
  ]);
  for (const row of recap.bench_analysis.teams) {
    assert.deepEqual([row.optimal_points, row.left_on_bench], expected.get(row.team_id));
  }
  assert.equal(recap.bench_analysis.league_total_left, 225.7);
});

test('recorded week 4 FAAB and Ollie Gordon II bidding war match verified values', () => {
  const recap = makeFixtureRecap();
  assert.equal(recap.roster_moves.league_faab_total, 78);
  const faabByTeam = new Map(recap.roster_moves.teams.map((row) => [row.team_id, row.faab_spent]));
  assert.deepEqual([faabByTeam.get(7), faabByTeam.get(1), faabByTeam.get(9), faabByTeam.get(6)], [64, 13, 1, 0]);
  const war = recap.roster_moves.bidding_wars.find((entry) => entry.player === 'Ollie Gordon II');
  assert.deepEqual(war.bids.map((bid) => bid.bid).sort((a, b) => b - a), [37, 32, 32, 23, 7]);
  assert.equal(war.total_bids, 131);
  assert.equal(war.winner_team_id, 7);
  assert.equal(war.winning_bid, 37);
});

test('greedy flex assignment matches brute-force maximum on deterministic random rosters', () => {
  const slots = [
    { slot: 'QB', type: 'START', count: 1, eligible_positions: ['QB'] },
    { slot: 'RB', type: 'START', count: 1, eligible_positions: ['RB'] },
    { slot: 'WR', type: 'START', count: 1, eligible_positions: ['WR'] },
    { slot: 'RB/WR/TE', type: 'FLEX', count: 1, eligible_positions: ['RB', 'WR', 'TE'] }
  ];
  const positions = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'TE'];
  let seed = 23;
  const random = () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  };
  function bruteForce(roster, slotIndex = 0, used = new Set()) {
    if (slotIndex === slots.length) return 0;
    const slot = slots[slotIndex];
    let best = bruteForce(roster, slotIndex + 1, used);
    for (const player of roster) {
      if (used.has(player.player_id) || !slot.eligible_positions.includes(player.position)) continue;
      used.add(player.player_id);
      best = Math.max(best, player.points + bruteForce(roster, slotIndex + 1, used));
      used.delete(player.player_id);
    }
    return best;
  }
  for (let run = 0; run < 40; run++) {
    const roster = positions.map((position, index) => ({
      player_id: index,
      position,
      name: `${position}-${index}`,
      lineup_slot: 'BE',
      points: Math.floor(random() * 301) / 10
    }));
    const actual = solveOptimalLineup({ roster, lineupSlots: slots });
    assert.equal(Math.round(actual.optimal_points * 100), Math.round(bruteForce(roster) * 100));
  }
});

test('median scoring is strict and may be omitted when disabled', () => {
  const teams = [{ team_id: 1, team_name: 'One' }, { team_id: 2, team_name: 'Two' }];
  const matchups = [{ home_team_id: 1, away_team_id: 2, home_score: 100, away_score: 90 }];
  const result = calculateWeekScoring({ week: 1, teams, matchups, medianScoring: true });
  assert.equal(result.rows.find((row) => row.team_id === 1).median_result, 'W');
  const disabled = calculateWeekScoring({ week: 1, teams, matchups, medianScoring: false });
  assert.equal('median_result' in disabled.rows.find((row) => row.team_id === 1), false);
  assert.equal('median' in disabled, false);
});

function validationFixture() {
  const teams = [{ team_id: 1, team_name: 'One' }, { team_id: 2, team_name: 'Two' }];
  const week = calculateWeekScoring({
    week: 1,
    teams,
    matchups: [{ home_team_id: 1, away_team_id: 2, home_score: 100, away_score: 90 }]
  });
  const standings = calculateStandings({ teams, weeks: [week], week: 1, medianScoring: true, regularSeasonWeeks: 1, playoffTeamCount: 1 }).standings;
  const benchAnalysis = {
    teams: teams.map((team) => ({ team_id: team.team_id, actual_points: team.team_id === 1 ? 100 : 90, left_on_bench: 0 })),
    league_total_left: 0
  };
  const availability = {
    teams: teams.map((team) => ({
      team_id: team.team_id,
      roster_present: true,
      flags: { no_qb: false, no_k: false, no_dst: false, missing_required_positions: [] }
    }))
  };
  return { teams, weeks: [week], standings, benchAnalysis, availability };
}

test('every reconciliation check has a failing-case test', () => {
  const cases = [
    ['points_for:1', (data) => { data.standings[0].points_for++; }],
    ['wins_reconcile:1', (data) => { data.standings[0].wins++; }],
    ['starters_total:1', (data) => { data.benchAnalysis.teams[0].actual_points++; }],
    ['points_against:1', (data) => { data.standings[0].points_against++; }],
    ['bench_total', (data) => { data.benchAnalysis.league_total_left++; }],
    ['all_play_balance', (data) => { data.standings[0].all_play.losses++; }],
    ['next_roster_coverage', (data) => { data.availability.teams.pop(); }]
  ];
  for (const [checkName, corrupt] of cases) {
    const data = structuredClone(validationFixture());
    corrupt(data);
    const result = validateRecap(data);
    assert.equal(result.checks.find((entry) => entry.name === checkName)?.passed, false, checkName);
  }
});

test('recap tools and weekly_recap prompt are registered with expected names and instructions', () => {
  const tools = new Map();
  registerAllTools({ registerTool: (name, schema, handler) => tools.set(name, { schema, handler }) }, {
    defaults: {}, get: async () => ({})
  });
  for (const name of ['get_recap_data', 'get_all_play', 'get_bench_analysis', 'get_faab_summary', 'get_availability', 'get_recap_validation']) {
    assert.ok(tools.has(name), name);
  }
  const prompts = new Map();
  registerPrompts({ registerPrompt: (name, schema, handler) => prompts.set(name, { schema, handler }) });
  const prompt = prompts.get('weekly_recap');
  assert.ok(prompt);
  const result = prompt.handler({});
  const text = result.messages[0].content.text;
  assert.match(text, /Call get_recap_data, check validation\.passed, and compute nothing yourself/);
  assert.match(text, /Week N\+1 Preview/);
});

test('recorded weekly and season records match verified values', () => {
  const recap = makeFixtureRecap();
  assert.equal(recap.week_summary.season_high.score, 220.6);
  assert.equal(recap.week_summary.previous_season_high.score, 191.4);
  assert.equal(recap.week_summary.largest_margin.margin, 103.75);
  assert.equal(recap.week_summary.previous_largest_margin.margin, 58.35);
  assert.equal(recap.week_summary.closest_margin.margin, 4);
  assert.equal(recap.bench_analysis.league_total_left, 225.7);
});

test('missing projections are omitted from duds instead of treated as zero', () => {
  const result = analyzePlayers({
    week: 2,
    weeklyData: [{ week: 2, teams: [{ team_id: 1, team_name: 'One', players: [
      { player_id: 1, name: 'No Forecast', position: 'RB', lineup_slot: 'RB', points: 10, projected_points: null }
    ] }] }]
  });
  assert.equal(result.studs[0].projection_delta, null);
  assert.deepEqual(result.duds, []);
});

test('recap schema and section selection preserve defaults and compact only null fields', () => {
  const recap = makeFixtureRecap();
  delete recap.name_snapshot;
  assert.equal(recapSchema.safeParse(recap).success, true);
  assert.deepEqual(selectRecapSections(recap), recap);
  assert.deepEqual(Object.keys(selectRecapSections(recap, { sections: [] })), ['schema_version', 'meta']);
  const selected = selectRecapSections(recap, { sections: ['team_lineups', 'injury_watch'], compact: true });
  assert.equal(recapSchema.safeParse(selected).success, true);
  assert.equal('scoreboard' in selected, false);
  assert.throws(() => selectRecapSections(recap, { sections: ['bogus'] }), /Unknown/);
  assert.deepEqual(selectRecapSections({ absent: null, zero: 0, flag: false, rows: [null, { absent: null }] }, { compact: true }),
    { zero: 0, flag: false, rows: [null, {}] });
  assert.deepEqual(getRecapSchema()['x-sections'], RECAP_SECTIONS);
  const tools = new Map();
  registerAllTools({ registerTool: (name, schema, handler) => tools.set(name, { schema, handler }) }, { defaults: {} });
  assert.ok(tools.has('get_recap_schema'));
  assert.equal(tools.get('get_recap_data').schema.inputSchema.safeParse({ sections: ['bogus'] }).success, false);
});

test('actual team lineups match box scores, not optimal assignments', () => {
  const recap = makeFixtureRecap();
  for (const game of boxScoresByWeek[3].box_scores) {
    for (const side of ['home', 'away']) {
      const team = teams.find((row) => row.team_name === game[`${side}_team`]);
      const actual = recap.team_lineups.find((row) => row.team_id === team.team_id);
      const raw = game[`${side}_lineup`];
      assert.deepEqual(actual.starters.map((row) => row.player_id).sort(), raw.filter((row) => !['BE', 'IR'].includes(row.slot_position)).map((row) => row.player_id).sort());
      for (const row of [...actual.starters, ...actual.bench, ...actual.ir]) {
        const source = raw.find((player) => player.player_id === row.player_id);
        assert.deepEqual([row.slot, row.points, row.projected_points], [source.slot_position, source.points, source.projected_points]);
      }
    }
  }
});

test('preview references, standings ranks, names, bid aliases and week labels are explicit', () => {
  const recap = makeFixtureRecap();
  const standings = new Map(recap.standings.map((row) => [row.team_id, row]));
  for (const game of recap.scoreboard) {
    assert.equal(game.home_rank, standings.get(game.home_team_id).rank);
    assert.equal(game.away_rank, standings.get(game.away_team_id).rank);
  }
  for (const game of recap.preview) for (const team of game.teams) {
    assert.deepEqual(team.availability, { team_id: team.team_id });
  }
  for (const team of recap.teams) assert.equal(team.display_name, team.name.trim());
  assert.deepEqual(recap.name_snapshot, Object.fromEntries(teams.map((team) => [String(team.team_id), team.team_name ?? team.name])));
  for (const war of recap.roster_moves.bidding_wars) {
    assert.equal(war.bid_count, war.bids.length);
    assert.equal(war.total_bid_amount, war.total_bids);
    assert.equal(war.total_bid_amount, war.bids.reduce((sum, row) => sum + row.bid, 0));
  }
  assert.equal(recap.injuries_and_byes.slot_week, 5);
  assert.equal(recap.injuries_and_byes.week_points_week, 4);
  for (const team of recap.injuries_and_byes.teams) for (const player of [...team.injuries, ...team.byes, ...team.ir_players]) {
    assert.equal(player.next_week_slot, player.slot);
    assert.notEqual(player.pro_team, 'None');
  }
});

test('injury watch applies each threshold, excludes healthy/low-interest players and uses team-specific points', () => {
  const players = [
    { player_id: 1, season_points_rank: 150, lineup_slot: 'BE' },
    { player_id: 2, percent_owned: 60, lineup_slot: 'BE' },
    { player_id: 3, lineup_slot: 'QB' },
    { player_id: 4, season_points_rank: 151, percent_owned: 59.9, lineup_slot: 'BE' },
    { player_id: 5, season_points_rank: 1, injury_status: 'ACTIVE', lineup_slot: 'BE' },
    { player_id: 6, season_points_rank: 1, pro_team: 'None', lineup_slot: 'QB', on_bye_week: true }
  ].map((player) => ({ name: `Player ${player.player_id}`, position: 'QB', injury_status: 'OUT', ...player }));
  const data = { teams: [{ team_id: 1 }], rostersByTeam: new Map([[1, players]]), currentPlayersByTeam: new Map([[1, [{ player_id: 3, points: 12 }]]]),
    lineupSlots: [{ slot: 'QB', type: 'START', count: 1 }] };
  const details = buildRosterDetails(data);
  assert.deepEqual(details.injury_watch.map((row) => row.player_id), [1, 2, 3]);
  assert.deepEqual(details.injury_watch.map((row) => row.matched_criteria), [['season_points_rank'], ['percent_rostered'], ['next_week_starter']]);
  assert.equal(details.injury_watch[2].week_points, 12);
  assert.equal(details.injury_watch[0].week_points, null);
  const availability = buildAvailability({ ...data, priorWeekPlayersByTeam: data.currentPlayersByTeam });
  assert.deepEqual(availability.bye_teams, []);
  assert.ok(!JSON.stringify(availability).includes('None'));
});

test('season rank reuses rostered season-point rankings, never positional ranks', () => {
  const data = buildRosterDetails({ teams: [{ team_id: 1 }], currentPlayersByTeam: new Map(),
    rostersByTeam: new Map([[1, [
      { player_id: 1, name: 'Ranked', position: 'QB', injury_status: 'OUT', total_points: 100, lineup_slot: 'BE' },
      { player_id: 2, name: 'Position only', position: 'QB', injury_status: 'OUT', pos_rank: 1, lineup_slot: 'BE' }
    ]]]), lineupSlots: [] });
  assert.deepEqual(data.injury_watch.map((row) => [row.player_id, row.season_points_rank]), [[1, 1]]);
});

test('failed bid outcomes distinguish price, ties, prior drops and invalid sources', () => {
  const claim = (team_id, playerId, bid_amount, status, date, dropId) => ({ team_id, bid_amount, status, date, scoring_period: 4, type: 'WAIVER',
    items: [{ type: 'ADD', playerId, player: String(playerId) }, ...(dropId ? [{ type: 'DROP', playerId: dropId }] : [])] });
  const transactions = [
    claim(1, 1, 10, 'EXECUTED', 2000), claim(2, 1, 5, 'FAILED_INVALIDPLAYERSOURCE', 2001),
    claim(1, 2, 10, 'EXECUTED', 3000), claim(2, 2, 10, 'FAILED_INVALIDPLAYERSOURCE', 3001),
    claim(2, 3, 0, 'EXECUTED', 1000, 99), claim(2, 4, 1, 'FAILED_INVALIDPLAYERSOURCE', 4000, 99),
    claim(2, 5, 1, 'FAILED_INVALIDPLAYERSOURCE', 5000)
  ];
  const result = summarizeTransactions({ transactions, teams: [{ team_id: 1 }, { team_id: 2 }], playersByTeam: new Map(), week: 4 });
  assert.deepEqual(result.teams[1].failed_bids.map((row) => row.outcome), ['outbid', 'tiebreak_lost', 'unknown', 'unknown']);
  assert.ok(result.teams[1].failed_bids.every((row) => row.reason === 'FAILED_INVALIDPLAYERSOURCE'));
});

test('repeated acquisitions retain chronology and points only from the owning box score', () => {
  const transactions = [2, 1].map((team_id) => ({ team_id, type: 'FREEAGENT', status: 'EXECUTED', date: team_id * 1000,
    items: [{ type: 'ADD', playerId: 7, player: 'Traveler' }] }));
  const result = summarizeTransactions({ transactions, teams: [{ team_id: 1 }, { team_id: 2 }],
    playersByTeam: new Map([[2, [{ player_id: 7, points: 14, lineup_slot: 'BE' }]]]), week: 4 });
  assert.deepEqual(result.teams.map((team) => team.executed_claims.map((row) => [row.acquired_order, row.week_points])), [[[1, null]], [[2, 14]]]);
});

test('pending claims include only next-week pending or canceled waiver and free-agent claims', () => {
  const base = { league, settings: settingsPayload.settings, teams, week: 4, regularSeason: true,
    boxScoresByWeek, rosterResponses, transactions };
  const rows = [
    { type: 'WAIVER', status: 'PENDING', scoring_period: 5 },
    { type: 'FREEAGENT', status: 'CANCELED', scoring_period: 5 },
    { type: 'WAIVER', status: 'PENDING', scoring_period: 4 },
    { type: 'WAIVER', status: 'EXECUTED', scoring_period: 5 },
    { type: 'TRADE', status: 'PENDING', scoring_period: 5 }
  ];
  assert.deepEqual(buildRecapData({ ...base, pendingTransactions: rows }).pending_claims, rows.slice(0, 2));
});