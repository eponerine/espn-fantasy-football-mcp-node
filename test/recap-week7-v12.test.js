import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { BASELINE_REF, COMPACT_REQUESTED_OPTIONS, migrateFixture, readOriginalFixture, availabilityPlayers, legacyCompact, payloadSizes } from '../scripts/migrate-recap-v12-fixture.js';
import { buildRecapData } from '../recap/build.js';
import { buildRosterDetails, normalizeRecapStrings, selectRecapSections, STARTER_SLOT_ORDER } from '../recap/payload.js';
import { getRecapSchema, recapSchema } from '../recap/schema.js';
import { toCents } from '../recap/numbers.js';

const fixture = JSON.parse(await readFile(new URL('../tests/fixtures/recap_w7.json', import.meta.url), 'utf8'));
const original = readOriginalFixture();
const { settings } = JSON.parse(await readFile(new URL('../tests/fixtures/settings.json', import.meta.url), 'utf8'));
const lineupPlayers = team => [...team.starters, ...team.bench, ...team.ir];
const failedBids = fixture.roster_moves.teams.flatMap(team => team.failed_bids);

test('A1 failed bids use unique captured winners, preserve reasons and reject Perine ambiguity', () => {
  for (const failed of failedBids) {
    const wars = original.roster_moves.bidding_wars.filter(war => war.player_id === failed.player_id);
    const winner = wars.length === 1 ? wars[0].bids.find(bid => bid.status === 'EXECUTED') : null;
    assert.equal(failed.winner_team_id, winner?.team_id ?? null);
    assert.equal(failed.winning_bid, winner?.bid ?? null);
    assert.equal(failed.outcome, winner && winner.bid > failed.bid ? 'outbid'
      : winner && winner.bid === failed.bid ? 'tiebreak_lost'
        : !winner && failed.reason === 'FAILED_PLAYERALREADYDROPPED' ? 'player_already_dropped' : 'unknown');
  }
  const noel = failedBids.find(row => row.player.includes('Noel'));
  assert.equal(noel.outcome, 'tiebreak_lost');
  const perine = original.roster_moves.teams.flatMap(team => team.failed_bids).find(row => row.player.includes('Perine'));
  assert.ok(perine);
  assert.equal(failedBids.find(row => row.player_id === perine.player_id).reason, perine.reason);
  assert.equal(failedBids.find(row => row.player_id === perine.player_id).outcome, 'player_already_dropped');
  const synthetic = structuredClone(original);
  const war = { ...structuredClone(original.roster_moves.bidding_wars[0]), player_id: perine.player_id, player: perine.player };
  synthetic.roster_moves.bidding_wars.push(war, structuredClone(war));
  synthetic.roster_moves.teams[0].failed_bids.push({ ...perine });
  const migrated = migrateFixture(synthetic, settings).roster_moves.teams[0].failed_bids.at(-1);
  assert.equal(migrated.reason, perine.reason);
  assert.equal(migrated.outcome, 'player_already_dropped');
  assert.equal(migrated.winner_team_id, null);
  assert.equal(migrated.winning_bid, null);
});

test('A2 captured failed bids explicitly include winner fields and retain the winner alias', () => {
  assert.ok(failedBids.length > 0);
  const normalized = normalizeRecapStrings(original);
  for (const failed of failedBids) {
    for (const field of ['reason', 'outcome', 'winner_team_id', 'winning_bid', 'winner']) {
      assert.ok(Object.hasOwn(failed, field), `${failed.player}: ${field}`);
    }
    const wars = normalized.roster_moves.bidding_wars.filter(war => war.player_id === failed.player_id);
    const winner = wars.length === 1 ? wars[0].bids.find(bid => bid.status === 'EXECUTED') : null;
    assert.equal(failed.winner, winner?.team ?? null);
    assert.equal(failed.winner_team_id, winner?.team_id ?? null);
    assert.equal(failed.winning_bid, winner?.bid ?? null);
  }
});

test('A3 raw team names and sanitized owners survive while display strings trim', () => {
  assert.deepEqual(fixture.teams.map(team => team.name), original.teams.map(team => team.name));
  for (const team of fixture.teams) {
    assert.equal(team.owner_name, `owner_${team.team_id}`);
    assert.equal(team.display_name, team.name.trim());
  }
  assert.deepEqual(fixture, normalizeRecapStrings(fixture));
  assert.ok(fixture.scoreboard.every(game => game.home_team === game.home_team.trim() && game.away_team === game.away_team.trim()));
});

test('B3 availability slots alias next-week roster assignments', () => {
  assert.equal(fixture.injuries_and_byes.metadata.slot_alias, 'next_week_slot');
  assert.match(fixture.injuries_and_byes.metadata.slot_semantics, /not final next-week lineups/);
  for (const team of fixture.injuries_and_byes.teams) for (const row of availabilityPlayers(team)) assert.equal(row.slot, row.next_week_slot);
});

test('A4 lineup metadata uses retained evidence and null pro teams never imply byes', () => {
  for (const team of fixture.team_lineups) for (const row of lineupPlayers(team)) {
    for (const key of ['pro_team', 'injury_status', 'percent_rostered', 'is_bye_next_week']) assert.ok(Object.hasOwn(row, key));
    if (row.pro_team === null) assert.equal(row.is_bye_next_week, false);
    assert.notEqual(row.pro_team, 'None');
    if (row.pro_team != null) assert.ok(original.injuries_and_byes.teams.flatMap(availabilityPlayers)
      .some(player => player.player_id === row.player_id && player.pro_team === row.pro_team)
      || original.bench_analysis.teams.flatMap(team => team.assignment).some(player => player.player_id === row.player_id && player.pro_team === row.pro_team));
  }
  const captured = fixture.team_lineups[0].starters[0];
  for (const proTeam of [null, 'None']) {
    const player = { ...captured, lineup_slot: captured.slot, pro_team: proTeam, on_bye_week: true };
    const result = buildRosterDetails({ teams: [fixture.teams[0]], currentPlayersByTeam: new Map([[fixture.teams[0].team_id, [player]]]),
      rostersByTeam: new Map([[fixture.teams[0].team_id, [player]]]), lineupSlots: settings.lineup_slots, week: 7, injuries_as_of: original.meta.generated_at });
    assert.equal(result.team_lineups[0].starters[0].pro_team, null);
    assert.equal(result.team_lineups[0].starters[0].is_bye_next_week, false);
  }
});

test('A5 actual lineup totals reconcile in cents without changing any captured player calculations', () => {
  assert.equal(fixture.team_lineups_week, 7);
  for (const team of fixture.team_lineups) {
    assert.equal(team.roster_week, 7);
    assert.equal(toCents(team.starters_total), team.starters.reduce((total, row) => total + toCents(row.points), 0));
    assert.equal(toCents(team.bench_total), team.bench.reduce((total, row) => total + toCents(row.points), 0));
    const slots = team.starters.map(row => STARTER_SLOT_ORDER.indexOf(row.slot));
    assert.deepEqual(slots, [...slots].sort((left, right) => left - right));
    const before = original.team_lineups.find(row => row.team_id === team.team_id);
    for (const player of lineupPlayers(team)) {
      const previous = lineupPlayers(before).find(row => row.player_id === player.player_id);
      for (const key of ['points', 'projected_points', 'slot', 'player_id']) assert.equal(player[key], previous[key]);
    }
  }
  for (const game of fixture.scoreboard) for (const side of ['home', 'away']) {
    const lineup = fixture.team_lineups.find(team => team.team_id === game[`${side}_team_id`]);
    assert.equal(toCents(lineup.starters_total), toCents(game[`${side}_score`]));
  }
});

test('A6 synthetic week-seven build filters pending claims and counts raw next-week source rows', () => {
  const teams = fixture.teams;
  const lineup = teamId => lineupPlayers(fixture.team_lineups.find(team => team.team_id === teamId))
    .map(player => ({ ...player, slot_position: player.slot }));
  const boxScores = fixture.scoreboard.map(game => ({ ...game, home_lineup: lineup(game.home_team_id), away_lineup: lineup(game.away_team_id) }));
  const pendingTransactions = [
    { team_id: 1, type: 'WAIVER', status: 'PENDING', scoring_period: 8 },
    { team_id: 1, type: 'FREEAGENT', status: 'CANCELED', scoring_period: 8 },
    { team_id: 1, type: 'WAIVER', status: 'CANCELLED', scoring_period: 8 },
    { team_id: 1, type: 'WAIVER', status: 'EXECUTED', scoring_period: 8 },
    { team_id: 1, type: 'TRADE', status: 'PENDING', scoring_period: 8 },
    { team_id: 1, type: 'WAIVER', status: 'PENDING', scoring_period: 7 }
  ];
  const rosterResponses = original.injuries_and_byes.teams.map(team => ({ team_id: team.team_id,
    roster: [...new Map(availabilityPlayers(team).map(player => [player.player_id, { ...player, name: player.player,
      lineup_slot: player.slot, on_bye_week: team.byes.some(row => row.player_id === player.player_id) }])).values()] }));
  const result = buildRecapData({ league: { league_id: fixture.meta.league_id, year: 2026 }, settings, teams, week: 7,
    regularSeason: true, boxScoresByWeek: Array.from({ length: 7 }, (_, index) => ({ box_scores: index === 6 ? boxScores : [] })),
    rosterResponses, transactions: [], pendingTransactions });
  assert.deepEqual(result.pending_claims, pendingTransactions.slice(0, 3));
  assert.equal(result.pending_claims_meta.source_count, pendingTransactions.length);
  assert.equal(result.pending_claims_meta.scoring_period, 8);
});

test('A7 captured Shough/Darnold tie preserves IDs, points, projections and ranks (not raw verification)', () => {
  assert.deepEqual(fixture.players, normalizeRecapStrings(original).players);
  const tied = fixture.players.bench_top.filter(player => [4360689, 3912547].includes(player.player_id));
  assert.equal(tied.length, 2);
  for (const player of tied) {
    assert.equal(player.points, 18.45);
    assert.equal(player.league_score_rank, 43);
    const lineup = fixture.team_lineups.flatMap(lineupPlayers).find(row => row.player_id === player.player_id);
    const previous = original.team_lineups.flatMap(lineupPlayers).find(row => row.player_id === player.player_id);
    assert.equal(lineup.player_id, player.player_id);
    assert.equal(lineup.points, 18.45);
    assert.equal(lineup.projected_points, previous.projected_points);
    assert.equal(typeof lineup.projected_points, 'number');
  }
});

test('Migration is deterministic from an immutable baseline and retains the original generation date', () => {
  assert.deepEqual(fixture, migrateFixture(original, settings));
  assert.equal(fixture.schema_version, '1.2.0');
  assert.match(BASELINE_REF, /^[0-9a-f]{40}$/);
  assert.equal(fixture.meta.migration.source, `git show ${BASELINE_REF}:tests/fixtures/recap_w7.json`);
  assert.equal(fixture.meta.generated_at, original.meta.generated_at);
  assert.ok(fixture.meta.migration.unretained_fields.length);
});

test('Invariant: captured scoring, standings, season math and rankings are unchanged', () => {
  const normalized = normalizeRecapStrings(original);
  for (const key of ['week_summary', 'scoreboard', 'standings', 'season_summary', 'players', 'power_rankings', 'prior_power_rankings', 'validation']) {
    assert.deepEqual(fixture[key], normalized[key], key);
  }
});

test('B1 optimal assignment retains the assignment alias', () => {
  for (const team of fixture.bench_analysis.teams) {
    assert.deepEqual(team.optimal_assignment, team.assignment);
    const before = normalizeRecapStrings(original).bench_analysis.teams.find(row => row.team_id === team.team_id);
    for (const key of Object.keys(before)) assert.deepEqual(team[key], before[key]);
  }
});

test('B2 swap note describes independent noncumulative alternatives', () => {
  assert.match(fixture.bench_analysis.swap_note, /independent.*not cumulative/);
  assert.match(getRecapSchema().properties.bench_analysis.properties.teams.items.properties.swaps.description, /Independent.*not a simultaneous plan.*not be added/);
});

test('B4 roster weeks distinguish actual week-seven lineups from week-eight availability', () => {
  assert.equal(fixture.team_lineups_week, 7);
  assert.ok(fixture.team_lineups.length > 0);
  for (const team of fixture.team_lineups) assert.equal(team.roster_week, 7);
  assert.equal(fixture.injuries_and_byes.roster_week, 8);
  assert.ok(fixture.injury_watch.length > 0);
  for (const row of fixture.injury_watch) assert.equal(row.roster_week, 8);
});

test('B5 rank differences use espn_rank minus custom rank with a documented sign convention', () => {
  const schema = getRecapSchema();
  for (const section of ['power_rankings', 'prior_power_rankings']) {
    assert.match(schema.properties[section].items.properties.diff_vs_espn.description, /espn_rank - rank; positive.*higher than ESPN/);
    assert.ok(fixture[section].length > 0);
    for (const row of fixture[section]) {
      assert.equal(typeof row.espn_rank, 'number');
      assert.equal(typeof row.rank, 'number');
      assert.equal(row.diff_vs_espn, row.espn_rank - row.rank);
    }
  }
});

test('B6 availability and injury-watch timestamps retain the capture time and pass the full schema', () => {
  assert.equal(fixture.meta.generated_at, original.meta.generated_at);
  assert.equal(fixture.injuries_and_byes.injuries_as_of, original.meta.generated_at);
  assert.ok(fixture.injury_watch.length > 0);
  for (const row of fixture.injury_watch) assert.equal(row.injuries_as_of, original.meta.generated_at);
  assert.equal(recapSchema.safeParse(fixture).success, true);
  for (const target of ['availability', 'watch']) {
    const invalid = structuredClone(fixture);
    const row = target === 'availability' ? invalid.injuries_and_byes : invalid.injury_watch[0];
    row.injuries_as_of = 'not-a-timestamp';
    assert.equal(recapSchema.safeParse(invalid).success, false, target);
  }
});

test('C1 gaps are actionable by default and include_gap_detail preserves available detail immutably', () => {
  for (const team of fixture.injuries_and_byes.teams) {
    assert.equal(team.flags.starter_without_healthy_bench_cover, team.gaps.some(gap => gap.starter_without_healthy_bench_cover));
    for (const gap of team.gaps) {
      assert.equal(gap.starter_without_healthy_bench_cover, gap.starters_on_bye_or_out.length > 0 && gap.healthy_bench_eligible.length === 0);
      assert.ok(gap.empty_slots > 0 || gap.starter_without_healthy_bench_cover);
    }
  }
  const before = structuredClone(fixture);
  assert.deepEqual(selectRecapSections(fixture, { include_gap_detail: true }), fixture);
  const synthetic = structuredClone(fixture);
  synthetic.injuries_and_byes.teams[0].gaps.push({ slot: 'QB', empty_slots: 0, starter_without_healthy_bench_cover: false });
  assert.equal(selectRecapSections(synthetic, { include_gap_detail: false }).injuries_and_byes.teams[0].gaps.length, fixture.injuries_and_byes.teams[0].gaps.length);
  assert.equal(selectRecapSections(synthetic, { include_gap_detail: true }).injuries_and_byes.teams[0].gaps.length, fixture.injuries_and_byes.teams[0].gaps.length + 1);
  assert.equal(synthetic.injuries_and_byes.teams[0].gaps.length, fixture.injuries_and_byes.teams[0].gaps.length + 1);
  assert.deepEqual(fixture, before);
});

test('C4 preview flags derive from captured availability and documented IR capacity', () => {
  const capacity = settings.lineup_slots.filter(slot => slot.slot === 'IR').reduce((total, slot) => total + slot.count, 0);
  assert.match(fixture.meta.migration.ir_capacity_source, /settings.json/);
  for (const game of fixture.preview) for (const team of game.teams) {
    const availability = fixture.injuries_and_byes.teams.find(row => row.team_id === team.team_id);
    assert.deepEqual(team.availability, { team_id: team.team_id });
    assert.deepEqual(team.next_week_flags.starters_on_bye, availability.byes.filter(row => STARTER_SLOT_ORDER.includes(row.slot)).map(row => row.player));
    assert.equal(team.next_week_flags.open_ir_slots, Math.max(0, capacity - availability.ir_players.length));
    for (const [field, statuses] of [['questionable_starters', ['QUESTIONABLE']], ['out_starters', ['OUT', 'INJURY_RESERVE']]]) {
      assert.deepEqual(team.next_week_flags[field], availability.injuries.filter(row => STARTER_SLOT_ORDER.includes(row.slot) && statuses.includes(row.injury_status)).map(row => row.player));
    }
  }
});

test('Migration preserves explicitly unknown legacy pending coverage and passes the full schema', () => {
  assert.deepEqual(fixture.pending_claims, []);
  assert.equal(fixture.pending_claims_meta.source_count, null);
  assert.equal(fixture.pending_claims_meta.source_count_known, false);
  assert.equal(fixture.pending_claims_meta.fetched, null);
  assert.match(fixture.pending_claims_meta.source_note, /live recapture required/);
  assert.equal(recapSchema.safeParse(fixture).success, true);
});

test('Invariant: section selection retains mandatory context and matching section metadata', () => {
  const selected = selectRecapSections(fixture, { sections: ['team_lineups', 'pending_claims'] });
  assert.deepEqual(Object.keys(selected).sort(), ['schema_version', 'meta', 'team_lineups', 'team_lineups_week', 'pending_claims', 'pending_claims_meta'].sort());
  assert.equal(selected.team_lineups_week, 7);
  assert.deepEqual(selected.pending_claims_meta, fixture.pending_claims_meta);
  assert.throws(() => selectRecapSections(fixture, { sections: ['not_a_section'] }), /Unknown/);
});

test('C2 disabling history removes only swap history without mutating the fixture', () => {
  const before = structuredClone(fixture);
  const selected = selectRecapSections(fixture, { include_history: false });
  for (const team of selected.bench_analysis.teams) for (const swap of team.swaps) {
    for (const field of ['prior_week_points', 'last_3_weeks', 'starter_prior_week_points', 'starter_last_3_weeks']) assert.equal(Object.hasOwn(swap, field), false);
  }
  assert.deepEqual(fixture, before);
});

test('C3 assignment options remove both aliases and preserve swaps and calculations', () => {
  const before = structuredClone(fixture);
  const selected = selectRecapSections(fixture, { include_optimal_assignment: false });
  for (const team of selected.bench_analysis.teams) {
    assert.equal(Object.hasOwn(team, 'assignment'), false);
    assert.equal(Object.hasOwn(team, 'optimal_assignment'), false);
    assert.deepEqual(team.swaps, fixture.bench_analysis.teams.find(row => row.team_id === team.team_id).swaps);
  }
  assert.deepEqual(fixture, before);
});

test('C5 exact requested compact options reduce serialized, pretty and wrapper bytes versus legacy', () => {
  const before = structuredClone(fixture);
  assert.deepEqual(COMPACT_REQUESTED_OPTIONS, {
    compact: true, include_history: false, include_gap_detail: false, include_optimal_assignment: false
  });
  const compact = selectRecapSections(fixture, COMPACT_REQUESTED_OPTIONS);
  const expected = legacyCompact(selectRecapSections(fixture, { ...COMPACT_REQUESTED_OPTIONS, compact: false }));
  assert.deepEqual(compact, expected);
  for (const team of compact.bench_analysis.teams) {
    assert.equal(Object.hasOwn(team, 'assignment'), false);
    assert.equal(Object.hasOwn(team, 'optimal_assignment'), false);
    for (const swap of team.swaps) for (const field of ['prior_week_points', 'last_3_weeks', 'starter_prior_week_points', 'starter_last_3_weeks']) {
      assert.equal(Object.hasOwn(swap, field), false);
    }
  }
  const legacySizes = payloadSizes(legacyCompact(original));
  const requestedSizes = payloadSizes(compact);
  for (const metric of ['serialized', 'pretty', 'jsonResult']) assert.ok(requestedSizes[metric] < legacySizes[metric], metric);
  console.log(JSON.stringify({ compact_requested_options: COMPACT_REQUESTED_OPTIONS,
    before_compact_requested: legacySizes, after_compact_requested: requestedSizes }));
  assert.deepEqual(fixture, before);
});

test('Invariant: compact-only removes null object fields while retaining arrays, zero and false', () => {
  const before = structuredClone(fixture);
  assert.deepEqual(selectRecapSections(fixture, { compact: true }), legacyCompact(fixture));
  const synthetic = structuredClone(fixture);
  synthetic.meta.probe = { zero: 0, flag: false, empty: [], absent: null, array: [null, 0, false] };
  assert.deepEqual(selectRecapSections(synthetic, { compact: true }).meta.probe, { zero: 0, flag: false, empty: [], array: [null, 0, false] });
  assert.deepEqual(fixture, before);
});

test('D schema discovery describes v1.2 controls, slot semantics and independent swaps', () => {
  const schema = getRecapSchema();
  assert.equal(schema.properties.schema_version.const, '1.2.0');
  for (const name of ['include_history', 'include_gap_detail', 'include_optimal_assignment']) assert.ok(schema.description.includes(name));
  assert.match(schema.properties.bench_analysis.properties.teams.items.properties.swaps.description, /Independent/);
  assert.match(schema.properties.injuries_and_byes.description, /not a final next-week lineup/);
});