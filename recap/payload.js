import { rankTopPlayers } from '../src/domain/injury-report.js';
import { fromCents, toCents } from './numbers.js';

export const SCHEMA_VERSION = '1.2.0';
export const RECAP_SECTIONS = [
  'teams', 'week_summary', 'scoreboard', 'standings', 'season_summary', 'players',
  'bench_analysis', 'team_lineups', 'roster_moves', 'pending_claims',
  'injuries_and_byes', 'injury_watch', 'power_rankings', 'prior_power_rankings', 'preview', 'validation'
];

export function selectRecapSections(recap, {
  sections, compact = false, include_history = true, include_gap_detail = false, include_optimal_assignment = true
} = {}) {
  if (sections?.some((section) => !RECAP_SECTIONS.includes(section))) {
    throw new Error('Unknown recap section.');
  }
  const keys = ['schema_version', 'meta', ...(sections ?? [])];
  if (sections?.includes('team_lineups')) keys.push('team_lineups_week');
  if (sections?.includes('pending_claims')) keys.push('pending_claims_meta');
  const selected = structuredClone(sections == null ? recap : Object.fromEntries(
    keys.map((key) => [key, recap[key]])
  ));
  if (selected.bench_analysis) {
    for (const team of selected.bench_analysis.teams) {
      if (!include_optimal_assignment) {
        delete team.assignment;
        delete team.optimal_assignment;
      }
      if (!include_history) for (const swap of team.swaps) {
        for (const key of ['prior_week_points', 'last_3_weeks', 'starter_prior_week_points', 'starter_last_3_weeks']) delete swap[key];
      }
    }
  }
  if (!include_gap_detail && selected.injuries_and_byes) for (const team of selected.injuries_and_byes.teams) {
    team.gaps = team.gaps.filter((gap) => gap.empty_slots > 0 || gap.starter_without_healthy_bench_cover);
  }
  function trim(value) {
    if (Array.isArray(value)) return value.map(trim);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null)
        .map(([key, entry]) => [key, trim(entry)]));
    }
    return value;
  }
  return compact ? trim(selected) : selected;
}

export const STARTER_SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'RB/WR/TE', 'D/ST', 'K'];

export function normalizeRecapStrings(recap) {
  const rawNames = new Set(recap.teams.flatMap((team) => [team.name, team.abbreviation]).filter((value) => typeof value === 'string'));
  function visit(value, key, path) {
    if (key === 'name_snapshot') return value;
    if (Array.isArray(value)) return value.map((entry) => visit(entry, null, [...path, key]));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .map(([childKey, entry]) => [childKey, visit(entry, childKey, [...path, key])]));
    if (key === 'pro_team' && (value == null || String(value).trim().toLowerCase() === 'none')) return null;
    if (typeof value !== 'string' || (key === 'name' && path.at(-2) === 'teams' && path.length === 3)) return value;
    return rawNames.has(value) || ['team', 'team_name', 'home_team', 'away_team', 'abbreviation', 'team_abbrev', 'winner', 'display_name', 'renamed_from'].includes(key)
      ? value.trim() : value;
  }
  return visit(recap, null, []);
}

export function buildRosterDetails({ teams, currentPlayersByTeam, rostersByTeam, lineupSlots, week, injuries_as_of }) {
  const startingSlots = new Set(lineupSlots.filter((slot) => ['START', 'FLEX'].includes(slot.type)).map((slot) => slot.slot));
  const byeTeams = new Set([...rostersByTeam.values()].flat().filter((player) =>
    player.on_bye_week === true && player.pro_team && String(player.pro_team).trim().toLowerCase() !== 'none')
    .map((player) => player.pro_team));
  const teamLineups = [];
  const injuryWatch = [];
  const seasonRanks = new Map(rankTopPlayers(teams.map((team) => ({
    team_id: team.team_id, roster: (rostersByTeam.get(team.team_id) ?? []).filter((player) => player.total_points != null)
  })), Number.MAX_SAFE_INTEGER).map((player) => [player.player_id, player.ytd_rank]));
  for (const team of teams) {
    const roster = rostersByTeam.get(team.team_id) ?? [];
    const current = currentPlayersByTeam.get(team.team_id) ?? [];
    const currentById = new Map(current.map((player) => [player.player_id, player]));
    const rosterById = new Map(roster.map((player) => [player.player_id, player]));
    const rows = current.map((player) => {
      const percentRostered = player.percent_rostered ?? player.percent_owned
        ?? rosterById.get(player.player_id)?.percent_rostered ?? rosterById.get(player.player_id)?.percent_owned;
      const next = rosterById.get(player.player_id);
      const proTeam = player.pro_team ?? next?.pro_team ?? null;
      return {
        slot: player.lineup_slot ?? player.slot_position ?? null,
        player_id: player.player_id,
        name: player.name,
        position: player.position,
        points: player.points ?? null,
        projected_points: player.projected_points ?? null,
        percent_rostered: percentRostered ?? null,
        pro_team: String(proTeam).trim().toLowerCase() === 'none' ? null : proTeam,
        injury_status: next?.injury_status ?? player.injury_status ?? null,
        is_bye_next_week: Boolean(proTeam && String(proTeam).trim().toLowerCase() !== 'none'
          && (next?.on_bye_week === true || byeTeams.has(proTeam)))
      };
    });
    const starters = rows.filter((player) => startingSlots.has(player.slot))
      .sort((left, right) => STARTER_SLOT_ORDER.indexOf(left.slot) - STARTER_SLOT_ORDER.indexOf(right.slot));
    const bench = rows.filter((player) => player.slot === 'BE');
    teamLineups.push({
      team_id: team.team_id,
      roster_week: week,
      starters_total: fromCents(starters.reduce((total, player) => total + toCents(player.points), 0)),
      bench_total: fromCents(bench.reduce((total, player) => total + toCents(player.points), 0)),
      starters,
      bench,
      ir: rows.filter((player) => player.slot === 'IR')
    });
    for (const player of roster) {
      if (String(player.pro_team ?? '').trim().toLowerCase() === 'none') continue;
      const status = String(player.injury_status ?? '').toUpperCase();
      if (!player.injured && !['QUESTIONABLE', 'DOUBTFUL', 'OUT', 'DAY_TO_DAY', 'INJURY_RESERVE'].includes(status)) continue;
      const slot = player.lineup_slot ?? player.slot_position ?? null;
      const rank = player.season_points_rank ?? seasonRanks.get(player.player_id) ?? null;
      const percent = player.percent_rostered ?? player.percent_owned ?? null;
      const criteria = [];
      if (rank != null && rank > 0 && rank <= 150) criteria.push('season_points_rank');
      if (percent != null && percent >= 60) criteria.push('percent_rostered');
      if (startingSlots.has(slot)) criteria.push('next_week_starter');
      if (!criteria.length) continue;
      injuryWatch.push({
        injuries_as_of,
        roster_week: week == null ? null : week + 1,
        team_id: team.team_id, player_id: player.player_id, name: player.name, position: player.position,
        injury_status: player.injury_status ?? null, next_week_slot: slot,
        week_points: currentById.get(player.player_id)?.points ?? null,
        percent_rostered: percent, season_points_rank: rank, matched_criteria: criteria
      });
    }
  }
  return { team_lineups: teamLineups, injury_watch: injuryWatch };
}