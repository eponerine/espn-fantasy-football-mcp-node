import { readFileSync } from 'node:fs';

const read = (name) => JSON.parse(readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url), 'utf8'));
export const v12 = read('recap_w7_v12.json');
export const { settings } = read('settings.json');
// Raw /transactions responses captured live on 2026-10-28 (team names only, no credentials).
export const rawWeek7Transactions = read('transactions-week-7-raw.json').transactions;
export const rawWeek8Transactions = read('transactions-week-8-raw.json').transactions;

// Waiver batch processing window observed in the captured executed claims.
export const WAIVER_BATCH_AT = 1792566321307;
const lineupPlayers = (team) => [...team.starters, ...team.bench, ...team.ir];
const rawName = (teamId) => v12.teams.find((team) => team.team_id === teamId).name;

function boxPlayer(player) {
  return {
    player_id: player.player_id, name: player.name, position: player.position, slot_position: player.slot,
    points: player.points ?? 0, projected_points: player.projected_points ?? 0,
    ...(player.percent_rostered == null ? {} : { percent_owned: player.percent_rostered }),
    pro_team: player.pro_team ?? 'None', injury_status: player.injury_status
  };
}

function nextWeekRoster(teamId) {
  const lineup = v12.team_lineups.find((team) => team.team_id === teamId);
  const availability = v12.injuries_and_byes.teams.find((team) => team.team_id === teamId);
  const rows = [...availability.byes, ...availability.injuries, ...availability.ir_players];
  const nextSlot = new Map(rows.map((row) => [row.player_id, row.next_week_slot]));
  const roster = lineupPlayers(lineup).map((player) => ({
    ...boxPlayer(player), slot_position: nextSlot.get(player.player_id) ?? player.slot,
    on_bye_week: player.is_bye_next_week
  }));
  for (const row of availability.byes) {
    if (roster.some((player) => player.player_id === row.player_id)) continue;
    roster.push({ player_id: row.player_id, name: row.player, position: row.position, slot_position: row.next_week_slot,
      pro_team: row.pro_team ?? 'None', injury_status: 'ACTIVE', on_bye_week: true });
  }
  return roster;
}

export function createV12Client({ week8Transactions = rawWeek8Transactions } = {}) {
  return {
    get: async (path, params = {}) => {
      if (path === '/league') return { league_id: 380348, year: 2026, current_week: 8 };
      if (path === '/settings') return { settings };
      if (path === '/teams') return { teams: v12.teams.map((team) => ({ team_id: team.team_id, team_name: team.name,
        team_abbrev: team.abbreviation, owner_name: team.owner_name })) };
      if (path === '/box-scores') return { box_scores: Number(params.week) !== 7 ? [] : v12.scoreboard.map((game) => ({
        home_team: rawName(game.home_team_id), away_team: rawName(game.away_team_id),
        home_score: game.home_score, away_score: game.away_score, is_playoff: false, matchup_type: 'NONE',
        home_lineup: lineupPlayers(v12.team_lineups.find((team) => team.team_id === game.home_team_id)).map(boxPlayer),
        away_lineup: lineupPlayers(v12.team_lineups.find((team) => team.team_id === game.away_team_id)).map(boxPlayer)
      })) };
      if (path === '/roster') return { team_id: params.teamId, team_name: rawName(params.teamId), roster: nextWeekRoster(params.teamId) };
      if (path === '/power-rankings') {
        const rows = Number(params.week) === 7 ? v12.power_rankings : v12.prior_power_rankings;
        return { rankings: rows.map((row) => ({ team_id: row.team_id, rank: row.espn_rank, power_score: row.espn_power_score })) };
      }
      if (path === '/matchups') return { matchups: v12.preview.map((game) => ({
        home_team: rawName(game.home_team_id), away_team: rawName(game.away_team_id) })) };
      if (path === '/transactions') {
        return { transactions: Number(params.scoringPeriod) === 7 ? rawWeek7Transactions : week8Transactions };
      }
      throw new Error(`Unexpected path ${path}`);
    }
  };
}
