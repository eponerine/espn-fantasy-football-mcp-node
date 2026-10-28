import { rankTopPlayers } from '../src/domain/injury-report.js';

export const SCHEMA_VERSION = '1.1.0';
export const RECAP_SECTIONS = [
  'teams', 'week_summary', 'scoreboard', 'standings', 'season_summary', 'players',
  'bench_analysis', 'team_lineups', 'roster_moves', 'pending_claims',
  'injuries_and_byes', 'injury_watch', 'power_rankings', 'prior_power_rankings', 'preview', 'validation'
];

export function selectRecapSections(recap, { sections, compact = false } = {}) {
  if (sections?.some((section) => !RECAP_SECTIONS.includes(section))) {
    throw new Error('Unknown recap section.');
  }
  const selected = sections == null ? recap : Object.fromEntries(
    ['schema_version', 'meta', ...sections].map((key) => [key, recap[key]])
  );
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

export function buildRosterDetails({ teams, currentPlayersByTeam, rostersByTeam, lineupSlots }) {
  const startingSlots = new Set(lineupSlots.filter((slot) => ['START', 'FLEX'].includes(slot.type)).map((slot) => slot.slot));
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
      return {
        slot: player.lineup_slot ?? player.slot_position ?? null,
        player_id: player.player_id,
        name: player.name,
        position: player.position,
        points: player.points ?? null,
        projected_points: player.projected_points ?? null,
        ...(percentRostered == null ? {} : { percent_rostered: percentRostered })
      };
    });
    teamLineups.push({
      team_id: team.team_id,
      starters: rows.filter((player) => startingSlots.has(player.slot)),
      bench: rows.filter((player) => player.slot === 'BE'),
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
        team_id: team.team_id, player_id: player.player_id, name: player.name, position: player.position,
        injury_status: player.injury_status ?? null, next_week_slot: slot,
        week_points: currentById.get(player.player_id)?.points ?? null,
        percent_rostered: percent, season_points_rank: rank, matched_criteria: criteria
      });
    }
  }
  return { team_lineups: teamLineups, injury_watch: injuryWatch };
}