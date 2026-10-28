import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeRecapStrings, selectRecapSections, STARTER_SLOT_ORDER } from '../recap/payload.js';
import { fromCents, toCents } from '../recap/numbers.js';
import { jsonResult } from '../src/tools/shared.js';

const root = fileURLToPath(new URL('../', import.meta.url));
export const BASELINE_REF = '7971f8597a0139dcaac7b035396ed193e3cd5181';
export const COMPACT_REQUESTED_OPTIONS = Object.freeze({
  compact: true, include_history: false, include_gap_detail: false, include_optimal_assignment: false
});
export function readOriginalFixture() {
  return JSON.parse(execFileSync('git', ['show', `${BASELINE_REF}:tests/fixtures/recap_w7.json`], { cwd: root, encoding: 'utf8' }));
}

export function availabilityPlayers(team) {
  return [...team.byes, ...team.injuries, ...team.ir_players,
    ...team.gaps.flatMap(gap => [...gap.starters_on_bye_or_out, ...gap.healthy_bench_eligible])];
}

export function migrateFixture(original, settings) {
  const recap = structuredClone(original);
  const timestamp = original.meta.generated_at;
  const week = original.meta.week;
  const allAvailability = original.injuries_and_byes.teams.flatMap(availabilityPlayers);
  const irCapacity = settings.lineup_slots.filter(slot => slot.slot === 'IR')
    .reduce((total, slot) => total + Number(slot.count || 0), 0);
  recap.schema_version = '1.2.0';
  recap.meta.migration = {
    source: `git show ${BASELINE_REF}:tests/fixtures/recap_w7.json`,
    method: 'Mechanical migration of sanitized 1.1 capture; no live API or recalculation of scoring, standings or rankings.',
    unretained_fields: ['Complete next-week rosters and active slot counts (empty_slots is null)',
      'Pro teams and injury statuses absent from retained availability and assignment metadata (null)',
      'Missing percent_rostered (null)', 'Raw next-week transaction count (null)',
      'Transaction processing timestamps; unique captured bidding wars are proxies, not verified same-window matches'],
    ir_capacity_source: 'tests/fixtures/settings.json: settings.lineup_slots for the same captured league',
    empty_slots_note: 'Required counts alone cannot establish active counts; unknown empty_slots remain null.',
    injury_status_note: 'Snapshot statuses from retained availability/watch rows; absence is unknown, not healthy.'
  };
  recap.team_lineups_week = week;
  for (const lineup of recap.team_lineups) {
    const availability = original.injuries_and_byes.teams.find(team => team.team_id === lineup.team_id);
    const local = availabilityPlayers(availability);
    const assignment = original.bench_analysis.teams.find(team => team.team_id === lineup.team_id)?.assignment ?? [];
    for (const player of [...lineup.starters, ...lineup.bench, ...lineup.ir]) {
      const sameTeam = local.filter(row => row.player_id === player.player_id);
      const matches = sameTeam.length ? sameTeam : allAvailability.filter(row => row.player_id === player.player_id);
      const metadata = [...matches, ...assignment.filter(row => row.player_id === player.player_id)];
      const proTeam = metadata.find(row => row.pro_team != null)?.pro_team ?? null;
      player.pro_team = proTeam == null || String(proTeam).trim().toLowerCase() === 'none' ? null : proTeam;
      const watch = original.injury_watch.find(row => row.team_id === lineup.team_id && row.player_id === player.player_id);
      player.injury_status = matches.find(row => row.injury_status != null)?.injury_status ?? watch?.injury_status ?? null;
      player.percent_rostered ??= null;
      player.is_bye_next_week = Boolean(player.pro_team && (
        original.injuries_and_byes.teams.some(team => team.byes.some(row => row.player_id === player.player_id))
        || original.injuries_and_byes.bye_teams.includes(player.pro_team)));
    }
    lineup.roster_week = week;
    lineup.starters.sort((left, right) => STARTER_SLOT_ORDER.indexOf(left.slot) - STARTER_SLOT_ORDER.indexOf(right.slot));
    lineup.starters_total = fromCents(lineup.starters.reduce((total, player) => total + toCents(player.points), 0));
    lineup.bench_total = fromCents(lineup.bench.reduce((total, player) => total + toCents(player.points), 0));
  }
  Object.assign(recap.injuries_and_byes, {
    roster_week: week + 1, injuries_as_of: timestamp,
    metadata: { slot_alias: 'next_week_slot',
      slot_semantics: 'slot and next_week_slot are roster snapshot assignments, not final next-week lineups.' }
  });
  recap.injuries_and_byes.bye_teams = recap.injuries_and_byes.bye_teams.filter(team => String(team).trim().toLowerCase() !== 'none');
  for (const team of recap.injuries_and_byes.teams) {
    for (const row of availabilityPlayers(team)) row.next_week_slot = row.slot;
    for (const field of ['byes', 'injuries', 'ir_players']) {
      team[field] = team[field].filter(row => String(row.pro_team).trim().toLowerCase() !== 'none');
    }
    for (const gap of team.gaps) {
      gap.empty_slots ??= gap.active_count == null ? null : Math.max(0, gap.starter_count - gap.active_count);
      gap.starter_without_healthy_bench_cover = gap.starters_on_bye_or_out.length > 0 && gap.healthy_bench_eligible.length === 0;
    }
    team.gaps = team.gaps.filter(gap => gap.empty_slots > 0 || gap.starter_without_healthy_bench_cover);
    team.flags.starter_without_healthy_bench_cover = team.gaps.some(gap => gap.starter_without_healthy_bench_cover);
  }
  for (const row of recap.injury_watch) Object.assign(row, { roster_week: week + 1, injuries_as_of: timestamp });
  recap.bench_analysis.swap_note = 'Swaps are independent single-swap alternatives, not cumulative changes.';
  for (const team of recap.bench_analysis.teams) team.optimal_assignment = structuredClone(team.assignment);
  for (const team of recap.roster_moves.teams) for (const failed of team.failed_bids) {
    const wars = recap.roster_moves.bidding_wars.filter(war => war.player_id === failed.player_id);
    const winner = wars.length === 1 ? wars[0].bids.find(bid => bid.status === 'EXECUTED') : null;
    failed.winner_team_id = winner?.team_id ?? null;
    failed.winning_bid = winner?.bid ?? null;
    failed.winner = winner?.team ?? null;
    failed.outcome = winner && winner.bid > failed.bid ? 'outbid'
      : winner && winner.bid === failed.bid ? 'tiebreak_lost'
        : !winner && failed.reason === 'FAILED_PLAYERALREADYDROPPED' ? 'player_already_dropped' : 'unknown';
  }
  recap.pending_claims_meta = {
    scoring_period: week + 1, transaction_types_checked: ['WAIVER', 'FREEAGENT'],
    source_count: null, source_count_known: false, fetched: null,
    source_note: 'Legacy capture did not retain raw next-week transaction count; live recapture required.'
  };
  for (const game of recap.preview) for (const team of game.teams) {
    const availability = recap.injuries_and_byes.teams.find(row => row.team_id === team.team_id);
    const starter = row => STARTER_SLOT_ORDER.includes(row.next_week_slot);
    team.next_week_flags = {
      starters_on_bye: availability.byes.filter(starter).map(row => row.player),
      questionable_starters: availability.injuries.filter(row => starter(row) && row.injury_status === 'QUESTIONABLE').map(row => row.player),
      out_starters: availability.injuries.filter(row => starter(row) && ['OUT', 'INJURY_RESERVE'].includes(row.injury_status)).map(row => row.player),
      open_ir_slots: Math.max(0, irCapacity - availability.ir_players.length)
    };
  }
  return normalizeRecapStrings(recap);
}

export function legacyCompact(value) {
  if (Array.isArray(value)) return value.map(legacyCompact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, entry]) => entry !== null).map(([key, entry]) => [key, legacyCompact(entry)]));
  return value;
}

export function payloadSizes(value) {
  return {
    serialized: Buffer.byteLength(JSON.stringify(value)),
    pretty: Buffer.byteLength(JSON.stringify(value, null, 2)),
    jsonResult: Buffer.byteLength(JSON.stringify(jsonResult(value)))
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const original = readOriginalFixture();
  const { settings } = JSON.parse(await readFile(new URL('../tests/fixtures/settings.json', import.meta.url), 'utf8'));
  const migrated = migrateFixture(original, settings);
  await writeFile(new URL('../tests/fixtures/recap_w7.json', import.meta.url), `${JSON.stringify(migrated, null, 2)}\n`);
  console.log(JSON.stringify({ before: payloadSizes(original), after: payloadSizes(migrated),
    before_compact_requested: payloadSizes(legacyCompact(original)),
    after_compact_requested: payloadSizes(selectRecapSections(migrated, COMPACT_REQUESTED_OPTIONS)),
    compact_requested_options: COMPACT_REQUESTED_OPTIONS,
    before_compact_only: payloadSizes(legacyCompact(original)),
    after_compact_only: payloadSizes(selectRecapSections(migrated, { compact: true })),
    counts: { lineups: migrated.team_lineups.length, gaps_before: original.injuries_and_byes.teams.reduce((total, team) => total + team.gaps.length, 0),
      gaps_after: migrated.injuries_and_byes.teams.reduce((total, team) => total + team.gaps.length, 0),
      unknown_pro_team: migrated.team_lineups.flatMap(team => [...team.starters, ...team.bench, ...team.ir]).filter(player => player.pro_team === null).length }
  }, null, 2));
}