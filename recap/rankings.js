import { roundHalfUp, toCents } from './numbers.js';
import { calculateAllPlay } from './standings.js';

function rankWeek({ teams, weeks, medianScoring }) {
  const allPlay = calculateAllPlay({ teams, weeks, medianScoring });
  const byId = new Map(allPlay.rows.map((row) => [row.team_id, row]));
  return [...teams].map((team) => {
    const scored = weeks.reduce((total, week) => total + toCents(week.rows.find((row) => row.team_id === team.team_id)?.score), 0);
    return { team_id: team.team_id, points_for: scored / 100, ...byId.get(team.team_id) };
  }).sort((left, right) => right.all_play_win_pct - left.all_play_win_pct || right.points_for - left.points_for);
}

export function calculatePowerRankings({ teams, weeks, week, medianScoring = true, espnRankById = new Map() }) {
  const current = rankWeek({ teams, weeks: weeks.filter((entry) => entry.week <= week), medianScoring });
  const prior = rankWeek({ teams, weeks: weeks.filter((entry) => entry.week < week), medianScoring });
  const priorRank = new Map(prior.map((row, index) => [row.team_id, index + 1]));
  return current.map((row, index) => {
    const espn = espnRankById.get(row.team_id) ?? {};
    const rank = index + 1;
    const oldRank = priorRank.get(row.team_id) ?? null;
    return {
      team_id: row.team_id,
      team: teams.find((team) => team.team_id === row.team_id)?.team_name ?? null,
      rank,
      prior_rank: oldRank,
      change: oldRank == null ? null : oldRank - rank,
      all_play: row.all_play,
      all_play_win_pct: roundHalfUp(row.all_play_win_pct, 2),
      points_for: row.points_for,
      espn_rank: espn.rank ?? null,
      espn_power_score: espn.power_score ?? null,
      diff_vs_espn: espn.rank == null ? null : espn.rank - rank
    };
  });
}