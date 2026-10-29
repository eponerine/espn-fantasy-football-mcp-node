import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createV12Client, rawWeek7Transactions, rawWeek8Transactions, v12, WAIVER_BATCH_AT } from './helpers/recap-v12-mock.js';
import { PLAYER_NULLABLE_KEYS, SCHEMA_VERSION, selectRecapSections } from '../recap/payload.js';
import { getRecapSchema, recapSchema } from '../recap/schema.js';
import { summarizeTransactions } from '../recap/transactions.js';

const directory = await mkdtemp(join(tmpdir(), 'recap-v13-'));
process.env.RECAP_TEAM_NAME_CACHE = join(directory, 'snapshots.json');
const { createRecapHandler, registerRecapTools } = await import('../src/tools/recap-tools.js');
test.after(() => rm(directory, { recursive: true, force: true }));

const COMPACT = { compact: true, include_history: false, include_gap_detail: false, include_optimal_assignment: false };
const run = (args, client = createV12Client()) => createRecapHandler(client)({ week: 7, ...args });
const lineupPlayers = (team) => [...team.starters, ...team.bench, ...team.ir];
const summarize = (transactions) => summarizeTransactions({ transactions, teams: v12.teams, playersByTeam: new Map(), week: 7 });

test('fixture: starters_total sums starters and equals each team scoreboard score', () => {
  const scores = new Map(v12.scoreboard.flatMap((game) => [[game.home_team_id, game.home_score], [game.away_team_id, game.away_score]]));
  assert.equal(v12.team_lineups.length, 12);
  for (const team of v12.team_lineups) {
    const cents = team.starters.reduce((total, player) => total + Math.round(player.points * 100), 0);
    assert.equal(cents / 100, team.starters_total, `team ${team.team_id}`);
    assert.equal(team.starters_total, scores.get(team.team_id), `team ${team.team_id}`);
  }
});

test('A1 FAAB reconciles for every team; the team 1 gap is a $2 failed Caleb Douglas bid lost in dedupe', () => {
  const captured = v12.roster_moves.teams.find((team) => team.team_id === 1);
  const listedLost = captured.failed_bids.reduce((total, bid) => total + bid.bid, 0);
  assert.deepEqual([captured.faab_spent, listedLost, captured.faab_lost, captured.faab_bid], [10, 13, 13, 25]);
  const raw = rawWeek7Transactions.filter((row) => row.team_id === 1 && row.items.some((item) => item.playerId === 4869645));
  assert.deepEqual(raw.map((row) => [row.status, row.bid_amount]).sort(), [['FAILED_PLAYERALREADYDROPPED', 2], ['PENDING', 2]]);
  const result = summarize(rawWeek7Transactions);
  for (const team of result.teams) {
    const before = v12.roster_moves.teams.find((row) => row.team_id === team.team_id);
    assert.equal(team.faab_spent + team.faab_lost, team.faab_bid, `team ${team.team_id}`);
    assert.equal(team.failed_bids.reduce((total, bid) => total + bid.bid, 0), team.faab_lost, `team ${team.team_id}`);
    assert.equal(team.faab_spent, before.faab_spent);
    assert.equal(team.faab_bid, before.faab_bid);
    assert.equal(team.faab_unprocessed, 0);
    if (team.team_id !== 1) assert.equal(team.faab_lost, before.faab_lost);
  }
  const team1 = result.teams.find((team) => team.team_id === 1);
  assert.equal(team1.faab_lost, 15);
  assert.deepEqual(team1.failed_bids.find((bid) => bid.player_id === 4869645),
    { player_id: 4869645, player: 'Caleb Douglas', bid: 2, dropped_player: 'Cameron Dicker', reason: 'FAILED_PLAYERALREADYDROPPED',
      outcome: 'drop_player_already_dropped', winner_team_id: null, winning_bid: null, winner: null });
});

test('A2 Shough and Darnold 18.45 tie is carried per player_id, not copied', async () => {
  const bench = v12.team_lineups.find((team) => team.team_id === 2).bench;
  const shough = bench.find((player) => player.player_id === 4360689);
  const darnold = bench.find((player) => player.player_id === 3912547);
  assert.deepEqual([shough.points, darnold.points], [18.45, 18.45]);
  assert.notEqual(shough.projected_points, darnold.projected_points);
  const client = createV12Client();
  const original = client.get;
  client.get = async (path, params) => {
    const payload = await original(path, params);
    if (path === '/box-scores' && Number(params.week) === 7) for (const game of payload.box_scores) {
      for (const player of [...game.home_lineup, ...game.away_lineup]) if (player.player_id === 3912547) player.points = 18.44;
    }
    return payload;
  };
  const recap = await run({}, client);
  const rebuilt = recap.team_lineups.find((team) => team.team_id === 2).bench;
  assert.equal(rebuilt.find((player) => player.player_id === 4360689).points, 18.45);
  assert.equal(rebuilt.find((player) => player.player_id === 3912547).points, 18.44);
});

test('A3 compact output keeps explicit nulls for player pro_team, week_points, projected_points and percent_rostered', async () => {
  const recap = await run(COMPACT);
  const visit = (value, path) => {
    if (Array.isArray(value)) return value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
    if (!value || typeof value !== 'object') return;
    if ('player_id' in value) for (const [section, keys] of Object.entries(expectedKeys)) {
      if (path.startsWith(section)) for (const key of keys) assert.ok(Object.hasOwn(value, key), `${path}.${key}`);
    }
    for (const [key, entry] of Object.entries(value)) visit(entry, `${path}.${key}`);
  };
  const expectedKeys = {
    '.team_lineups': ['pro_team', 'projected_points', 'percent_rostered'],
    '.injuries_and_byes': ['pro_team', 'week_points'],
    '.injury_watch': ['week_points', 'percent_rostered'],
    '.roster_moves.teams': []
  };
  visit(recap, '');
  for (const team of recap.roster_moves.teams) for (const claim of team.executed_claims) assert.ok(Object.hasOwn(claim, 'week_points'));
  const team1 = recap.team_lineups.find((team) => team.team_id === 1);
  assert.equal(team1.bench.find((player) => player.player_id === 3116406).pro_team, null);
  assert.equal(team1.bench.find((player) => player.player_id === 4596334).percent_rostered, null);
  const dell = recap.injuries_and_byes.teams.find((team) => team.team_id === 2).byes.find((row) => row.player_id === 4366031);
  assert.equal(dell.week_points, null);
  assert.ok(!recap.team_lineups.some((team) => lineupPlayers(team).some((player) => player.player_id === 4366031)));
  const synthetic = selectRecapSections({ schema_version: SCHEMA_VERSION, meta: {}, probe: { player_id: 1, other: null,
    ...Object.fromEntries(PLAYER_NULLABLE_KEYS.map((key) => [key, null])) } }, { compact: true });
  assert.deepEqual(Object.keys(synthetic.probe).sort(), ['player_id', ...PLAYER_NULLABLE_KEYS].sort());
});

test('A4 team_lineups label statuses as week N+1 snapshots and normalize NORMAL to ACTIVE', async () => {
  const recap = await run({});
  assert.equal(v12.team_lineups.flatMap(lineupPlayers).some((player) => player.injury_status === 'NORMAL'), true);
  for (const team of recap.team_lineups) {
    assert.equal(team.roster_week, 7);
    assert.equal(team.status_week, 8);
    assert.equal(team.injury_status_as_of, recap.injuries_and_byes.injuries_as_of);
    for (const player of lineupPlayers(team)) assert.notEqual(player.injury_status, 'NORMAL');
  }
  const ravens = recap.team_lineups.find((team) => team.team_id === 1).starters.find((player) => player.player_id === -16033);
  assert.equal(ravens.injury_status, 'ACTIVE');
  const noel = recap.team_lineups.find((team) => team.team_id === 9).starters.find((player) => player.player_id === 4586312);
  assert.deepEqual([noel.points, noel.injury_status, noel.is_bye_next_week], [1.7, 'INJURY_RESERVE', true]);
});

test('A5 pending claims keep genuine pending rows and report source composition', async () => {
  assert.deepEqual(v12.pending_claims, []);
  assert.equal(v12.pending_claims_meta.source_count, 20);
  const live = await run({});
  assert.deepEqual(live.pending_claims, []);
  assert.equal(live.pending_claims_meta.source_count, rawWeek8Transactions.length);
  assert.ok(rawWeek8Transactions.every((row) => row.status === 'EXECUTED' || row.status.startsWith('FAILED_')));
  const add = (playerId, player) => [{ type: 'ADD', playerId, player }];
  const week8Transactions = [
    { team_id: 4, type: 'WAIVER', status: 'PENDING', scoring_period: 8, date: null, bid_amount: 6, items: add(1, 'Pending target') },
    { team_id: 2, type: 'FREEAGENT', status: 'EXECUTED', scoring_period: 8, date: 1, bid_amount: 0, items: add(4366031, 'Tank Dell') },
    { team_id: 3, type: 'WAIVER_ERROR', status: 'FAILED_INVALIDPLAYERSOURCE', scoring_period: 8, date: 2, bid_amount: 3, items: add(2, 'Error') }
  ];
  const recap = await run({}, createV12Client({ week8Transactions }));
  assert.deepEqual(recap.pending_claims, [week8Transactions[0]]);
  assert.deepEqual(recap.pending_claims_meta.transaction_types_checked, ['WAIVER', 'FREEAGENT', 'WAIVER_ERROR']);
  assert.equal(recap.pending_claims_meta.source_count, 3);
  assert.deepEqual(recap.pending_claims_meta.source_status_counts, {
    'WAIVER:PENDING': 1, 'FREEAGENT:EXECUTED': 1, 'WAIVER_ERROR:FAILED_INVALIDPLAYERSOURCE': 1
  });
  assert.equal(recapSchema.safeParse(recap).success, true);
});

test('A6 failed claims whose DROP player already left the roster are labelled by sequence', () => {
  const captured = v12.roster_moves.teams.find((team) => team.team_id === 10).failed_bids
    .filter((bid) => bid.reason === 'FAILED_PLAYERALREADYDROPPED');
  assert.deepEqual(captured.map((bid) => [bid.player, bid.bid, bid.outcome]),
    [['Jaleel McLaughlin', 13, 'player_already_dropped'], ['Samaje Perine', 18, 'player_already_dropped']]);
  const executed = (team_id, type, date, bid_amount, add, drop) => ({ team_id, type, status: 'EXECUTED', scoring_period: 7, date, bid_amount,
    items: [{ type: 'ADD', playerId: add[0], player: add[1] }, ...(drop ? [{ type: 'DROP', playerId: drop[0], player: drop[1] }] : [])] });
  const transactions = [
    executed(10, 'WAIVER', WAIVER_BATCH_AT, 23, [4426386, 'Roschon Johnson'], [2969939, 'Jameis Winston']),
    { ...executed(10, 'WAIVER', WAIVER_BATCH_AT + 5, 18, [3116389, 'Samaje Perine'], [2969939, 'Jameis Winston']), status: 'FAILED_PLAYERALREADYDROPPED' },
    executed(5, 'FREEAGENT', 1792577530105, 0, [3116389, 'Samaje Perine'], [2973405, 'Kalif Raymond'])
  ];
  const team10 = summarize(transactions).teams.find((team) => team.team_id === 10);
  assert.deepEqual(team10.failed_bids.map((bid) => [bid.player, bid.dropped_player, bid.outcome, bid.winner_team_id]),
    [['Samaje Perine', 'Jameis Winston', 'drop_player_already_dropped', null]]);
  const withoutDropEvidence = summarize([transactions[1], transactions[2]]).teams.find((team) => team.team_id === 10);
  assert.equal(withoutDropEvidence.failed_bids[0].outcome, 'player_already_dropped');
  const live = summarize(rawWeek7Transactions).teams.find((team) => team.team_id === 10).failed_bids
    .filter((bid) => bid.reason === 'FAILED_PLAYERALREADYDROPPED');
  assert.deepEqual(live.map((bid) => [bid.player, bid.dropped_player, bid.outcome]).sort(), [
    ['Jaleel McLaughlin', 'Chris Rodriguez Jr.', 'drop_player_already_dropped'],
    ['Samaje Perine', 'Jameis Winston', 'drop_player_already_dropped']]);
});

test('B1 season record objects carry team alongside name', async () => {
  const summary = (await run({})).week_summary;
  for (const key of ['week_high', 'week_low', 'season_high', 'previous_season_high', 'season_low']) {
    assert.equal(typeof summary[key].team, 'string', key);
  }
  for (const key of ['season_high', 'previous_season_high', 'season_low']) assert.equal(summary[key].team, summary[key].name);
});

test('B2 next_week_slot is the canonical availability slot and slim drops the slot alias', async () => {
  const full = await run({});
  assert.equal(full.injuries_and_byes.metadata.canonical_slot_field, 'next_week_slot');
  const slim = await run({ slim: true });
  for (const team of slim.injuries_and_byes.teams) for (const row of [...team.byes, ...team.ir_players]) {
    assert.equal(Object.hasOwn(row, 'slot'), false);
    assert.ok(Object.hasOwn(row, 'next_week_slot'));
  }
});

test('B3 schema documents swaps, diff_vs_espn and lineup week semantics', () => {
  const schema = getRecapSchema();
  assert.match(schema.properties.bench_analysis.properties.teams.items.properties.swaps.description, /Independent single-swap/);
  assert.match(schema.properties.power_rankings.items.properties.diff_vs_espn.description, /espn_rank - rank/);
  assert.match(schema.properties.team_lineups.description, /week N\b.*N\+1/);
  assert.equal(schema.properties.schema_version.const, '1.3.0');
});

test('C1 get_recap_data returns minified JSON by default and pretty JSON on request', async () => {
  const tools = new Map();
  registerRecapTools({ registerTool: (name, _config, handler) => tools.set(name, handler) }, createV12Client());
  const minified = (await tools.get('get_recap_data')({ week: 7, ...COMPACT })).content[0].text;
  const pretty = (await tools.get('get_recap_data')({ week: 7, ...COMPACT, pretty: true })).content[0].text;
  assert.equal(minified.includes('\n'), false);
  const mask = (text) => JSON.parse(text, (key, value) => ['generated_at', 'injuries_as_of', 'injury_status_as_of'].includes(key) ? 'T' : value);
  assert.deepEqual(mask(minified), mask(pretty));
  assert.ok(Buffer.byteLength(minified) < Buffer.byteLength(pretty) * 0.7);
});

test('C2 slim replaces duplicated objects with references and stays schema-valid', async () => {
  const full = await run({});
  const slim = await run({ slim: true });
  assert.equal(recapSchema.safeParse(slim).success, true);
  assert.deepEqual(slim.roster_moves.top_spender, { team_id: full.roster_moves.top_spender.team_id });
  assert.deepEqual(slim.bench_analysis.what_ifs, full.bench_analysis.what_ifs.map((row) => row.team_id));
  assert.deepEqual(slim.season_summary.luckiest, { team_id: full.season_summary.luckiest.team_id,
    luck_delta: full.season_summary.luckiest.luck_delta, expected_wins: full.season_summary.luckiest.expected_wins });
  assert.deepEqual(slim.season_summary.cut_line, full.season_summary.cut_line);
  const closest = slim.week_summary.closest_margin;
  assert.equal(slim.scoreboard[closest.matchup_index].home_team_id, full.week_summary.closest_margin.home_team_id);
  assert.deepEqual(Object.keys(slim.week_summary.largest_margin).sort(), ['away_team_id', 'home_team_id', 'margin', 'week']);
  for (const row of slim.prior_power_rankings) assert.deepEqual(Object.keys(row), ['team_id', 'rank', 'all_play', 'points_for']);
  for (const game of slim.preview) for (const team of game.teams) assert.deepEqual(Object.keys(team), ['team_id', 'espn_power_score', 'next_week_flags']);
  for (const team of slim.roster_moves.teams) assert.ok([...team.free_agent_adds, ...team.drops].every((name) => typeof name === 'string'));
  for (const team of slim.injuries_and_byes.teams) assert.deepEqual(Object.keys(team), ['team_id', 'byes', 'ir_players', 'gaps']);
  assert.deepEqual(slim.team_lineups, full.team_lineups.map((team) => ({ ...team, injury_status_as_of: slim.team_lineups[0].injury_status_as_of })));
  assert.deepEqual(slim.injury_watch.map((row) => row.player_id), full.injury_watch.map((row) => row.player_id));
  assert.ok(Buffer.byteLength(JSON.stringify(slim)) < Buffer.byteLength(JSON.stringify(full)));
});

test('owner_name prefers owner_names, then first/last name, then the ESPN username', async () => {
  const client = createV12Client();
  const original = client.get;
  const owners = {
    1: { owner_names: ['Owner One'], owners: [{ displayName: 'user1', firstName: 'Owner', lastName: 'One' }] },
    2: { owner_names: [], owners: [{ displayName: 'user2', firstName: 'Owner', lastName: 'Two' }] },
    3: { owners: [{ displayName: 'user3' }] }
  };
  client.get = async (path, params) => {
    const payload = await original(path, params);
    if (path === '/teams') payload.teams = payload.teams.map(({ owner_name, ...team }) => ({ ...team, ...owners[team.team_id] }));
    return payload;
  };
  const byId = new Map((await run({}, client)).teams.map((team) => [team.team_id, team.owner_name]));
  assert.deepEqual([byId.get(1), byId.get(2), byId.get(3), byId.get(4)], ['Owner One', 'Owner Two', 'user3', null]);
});

test('default (slim=false) output is unchanged from the 1.2.0 baseline apart from the listed fixes', async () => {
  const baseline = JSON.parse(await readFile(new URL('../tests/fixtures/recap_w7_v12_default_baseline.json', import.meta.url), 'utf8'));
  const current = await run({});
  const mask = (value) => JSON.parse(JSON.stringify(value), (key, entry) =>
    ['generated_at', 'injuries_as_of', 'injury_status_as_of'].includes(key) ? 'T' : entry);
  const revert = (recap) => {
    recap.schema_version = '1.2.0';
    for (const key of ['season_high', 'previous_season_high', 'season_low']) delete recap.week_summary[key]?.team;
    for (const team of recap.team_lineups) { delete team.status_week; delete team.injury_status_as_of; }
    for (const team of [...recap.roster_moves.teams, recap.roster_moves.top_spender]) {
      const before = baseline.roster_moves.teams.find((row) => row.team_id === team.team_id);
      const recovered = team.failed_bids.filter((bid) => !before.failed_bids.some((row) => row.player_id === bid.player_id));
      assert.deepEqual(recovered.map((bid) => [team.team_id, bid.player]), team.team_id === 1 ? [[1, 'Caleb Douglas']] : []);
      team.failed_bids = team.failed_bids.filter((bid) => !recovered.includes(bid));
      team.faab_lost -= recovered.reduce((total, bid) => total + bid.bid, 0);
      team.faab_bid += team.faab_unprocessed;
      delete team.unprocessed_bids;
      delete team.faab_unprocessed;
      for (const bid of team.failed_bids) {
        delete bid.dropped_player;
        if (bid.outcome === 'drop_player_already_dropped') bid.outcome = 'player_already_dropped';
      }
    }
    recap.pending_claims_meta = { scoring_period: 8, transaction_types_checked: ['WAIVER', 'FREEAGENT'],
      source_count: recap.pending_claims_meta.source_count };
    delete recap.injuries_and_byes.metadata.canonical_slot_field;
    return recap;
  };
  const normalizeStatus = (recap) => {
    for (const team of recap.team_lineups) for (const player of lineupPlayers(team)) {
      if (player.injury_status === 'NORMAL') player.injury_status = 'ACTIVE';
    }
    return recap;
  };
  assert.deepEqual(mask(revert(current)), mask(normalizeStatus(baseline)));
});
