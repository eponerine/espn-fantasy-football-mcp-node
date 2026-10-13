import { fromCents, toCents } from './numbers.js';

function check(name, expected, actual, pass) {
  return { name, expected, actual, passed: Boolean(pass) };
}

export function validateRecap({ teams, weeks, standings, benchAnalysis, availability, medianScoring = true, regularSeason = true }) {
  const checks = [];
  const selected = weeks.at(-1);
  const standingById = new Map(standings.map((row) => [row.team_id, row]));
  const lineupById = new Map(benchAnalysis.teams.map((row) => [row.team_id, row]));
  const availabilityById = new Map(availability.teams.map((row) => [row.team_id, row]));

  for (const team of teams) {
    if (regularSeason) {
      const total = weeks.reduce((sum, week) => sum + toCents(week.rows.find((row) => row.team_id === team.team_id)?.score), 0);
      const standing = standingById.get(team.team_id);
      checks.push(check(`points_for:${team.team_id}`, fromCents(total), standing?.points_for ?? null,
        standing != null && total === toCents(standing.points_for)));

      const weeklyWins = weeks.reduce((sum, week) => {
        const row = week.rows.find((entry) => entry.team_id === team.team_id);
        return sum + Number(row?.h2h_result === 'W') + Number(medianScoring && row?.median_result === 'W');
      }, 0);
      checks.push(check(`wins_reconcile:${team.team_id}`, weeklyWins, standing?.wins ?? null, standing?.wins === weeklyWins));

      const h2hPointsAgainst = weeks.reduce((sum, week) => {
        const row = week.rows.find((entry) => entry.team_id === team.team_id);
        const opponent = week.rows.find((entry) => entry.team_id === row?._h2h_opponent_id);
        return sum + toCents(opponent?.score);
      }, 0);
      checks.push(check(`points_against:${team.team_id}`, fromCents(h2hPointsAgainst), standing?.points_against ?? null,
        standing != null && h2hPointsAgainst === toCents(standing.points_against)));
    }

    if (selected) {
      const score = selected.rows.find((row) => row.team_id === team.team_id)?.score;
      const lineup = lineupById.get(team.team_id);
      checks.push(check(`starters_total:${team.team_id}`, score ?? null, lineup?.actual_points ?? null,
        lineup != null && toCents(score) === toCents(lineup.actual_points)));
    }
  }

  const coveredTeams = selected?.rows.filter((row) => row._h2h_opponent_id != null).length ?? 0;
  checks.push(check('score_coverage', teams.length, coveredTeams, coveredTeams === teams.length));

  const benchSum = benchAnalysis.teams.reduce((sum, row) => sum + toCents(row.left_on_bench), 0);
  checks.push(check('bench_total', fromCents(benchSum), benchAnalysis.league_total_left,
    benchSum === toCents(benchAnalysis.league_total_left)));
  const allPlayWins = standings.reduce((sum, row) => sum + row.all_play.wins, 0);
  const allPlayLosses = standings.reduce((sum, row) => sum + row.all_play.losses, 0);
  if (regularSeason) checks.push(check('all_play_balance', allPlayWins, allPlayLosses, allPlayWins === allPlayLosses));

  const rosterCoverage = teams.every((team) => {
    const availabilityRow = availabilityById.get(team.team_id);
    if (!availabilityRow || availabilityRow.roster_present !== true) return false;
    if (!Array.isArray(availabilityRow.flags.missing_required_positions)) return false;
    const expectedMissing = ['QB', 'K', 'D/ST'].filter((position) =>
      position === 'QB' ? availabilityRow.flags.no_qb
        : position === 'K' ? availabilityRow.flags.no_k
          : availabilityRow.flags.no_dst
    );
    return expectedMissing.join('|') === availabilityRow.flags.missing_required_positions.join('|');
  });
  const rosterEntries = availability.teams.length === teams.length && new Set(availability.teams.map((row) => row.team_id)).size === teams.length;
  const missingRequired = availability.teams
    .filter((row) => row.flags.missing_required_positions.length > 0)
    .map((row) => ({ team_id: row.team_id, positions: row.flags.missing_required_positions }));
  checks.push(check('next_roster_coverage', teams.length, {
    roster_count: availability.teams.length,
    roster_responses_present: availability.teams.filter((row) => row.roster_present === true).length,
    missing_positions: missingRequired
  }, rosterEntries && rosterCoverage));

  return { passed: checks.every((entry) => entry.passed), checks };
}