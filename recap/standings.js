import { fromCents, roundHalfUp, toCents } from './numbers.js';

function emptyRecord() {
  return { wins: 0, losses: 0, ties: 0 };
}

export function calculateAllPlay({ teams, weeks, medianScoring = true }) {
  const results = new Map(teams.map((team) => [team.team_id, emptyRecord()]));
  let totalWins = 0;
  let totalLosses = 0;
  for (const week of weeks) {
    for (const team of teams) {
      const own = week.rows.find((row) => row.team_id === team.team_id);
      for (const opponent of teams) {
        if (opponent.team_id === team.team_id) continue;
        const other = week.rows.find((row) => row.team_id === opponent.team_id);
        const ownScore = toCents(own?.score);
        const otherScore = toCents(other?.score);
        const outcome = ownScore > otherScore ? 'wins' : ownScore === otherScore ? 'ties' : 'losses';
        results.get(team.team_id)[outcome]++;
      }
    }
  }
  for (const value of results.values()) {
    totalWins += value.wins;
    totalLosses += value.losses;
  }
  const decisionsPlayed = weeks.length * (medianScoring ? 2 : 1);
  const rows = teams.map((team) => {
    const allPlay = results.get(team.team_id);
    const comparisons = allPlay.wins + allPlay.losses + allPlay.ties;
    const winPct = comparisons ? (allPlay.wins + allPlay.ties * 0.5) / comparisons : 0;
    return {
      team_id: team.team_id,
      all_play: allPlay,
      all_play_win_pct: winPct,
      expected_wins: winPct * decisionsPlayed,
      decisions_played: decisionsPlayed
    };
  });
  return { rows, total_wins: totalWins, total_losses: totalLosses };
}

export function calculateStandings({ teams, weeks, week, medianScoring = true, regularSeasonWeeks, playoffTeamCount }) {
  const allPlay = calculateAllPlay({ teams, weeks, medianScoring });
  const allPlayById = new Map(allPlay.rows.map((row) => [row.team_id, row]));
  const totals = new Map(teams.map((team) => [team.team_id, {
    team_id: team.team_id,
    name: team.team_name ?? team.name,
    abbreviation: team.team_abbrev ?? team.abbreviation ?? null,
    wins: 0,
    losses: 0,
    ties: 0,
    points_for_cents: 0,
    points_against_cents: 0,
    h2h_wins: 0,
    median_wins: 0,
    week_h2h_result: null,
    week_median_result: null
  }]));

  for (const weekResult of weeks) {
    const rowById = new Map(weekResult.rows.map((row) => [row.team_id, row]));
    for (const row of weekResult.rows) {
      const standing = totals.get(row.team_id);
      if (row.h2h_result === 'W') {
        standing.h2h_wins++;
        standing.wins++;
      } else if (row.h2h_result === 'L') standing.losses++;
      else if (row.h2h_result === 'T') standing.ties++;
      if (medianScoring && row.median_result === 'W') {
        standing.median_wins++;
        standing.wins++;
      } else if (medianScoring && row.median_result === 'L') standing.losses++;
      standing.points_for_cents += toCents(row.score);
      const opponent = rowById.get(row._h2h_opponent_id);
      if (opponent) standing.points_against_cents += toCents(opponent.score);
      if (weekResult.week === week) {
        standing.week_h2h_result = row.h2h_result;
        standing.week_median_result = medianScoring ? row.median_result : null;
      }
    }
  }

  const standings = [...totals.values()];
  standings.sort((left, right) => right.wins - left.wins || right.points_for_cents - left.points_for_cents);
  standings.forEach((standing, index) => {
    standing.rank = index + 1;
    const allPlayRow = allPlayById.get(standing.team_id);
    standing.record = `${standing.wins}-${standing.losses}${standing.ties ? `-${standing.ties}` : ''}`;
    standing.points_for = fromCents(standing.points_for_cents);
    standing.points_against = fromCents(standing.points_against_cents);
    standing.all_play = allPlayRow.all_play;
    standing.all_play_win_pct = roundHalfUp(allPlayRow.all_play_win_pct, 2);
    standing.expected_wins = roundHalfUp(allPlayRow.expected_wins, 2);
    standing.luck_delta = roundHalfUp(standing.wins - allPlayRow.expected_wins, 2);
    delete standing.points_for_cents;
    delete standing.points_against_cents;
  });

  const inTeam = standings[playoffTeamCount - 1] ?? null;
  const outTeam = standings[playoffTeamCount] ?? null;
  const remainingWeeks = Math.max(0, (regularSeasonWeeks ?? week) - week);
  return {
    standings,
    all_play: allPlay,
    cut_line: {
      last_team_in: inTeam ? { team_id: inTeam.team_id, name: inTeam.name, record: inTeam.record, points_for: inTeam.points_for } : null,
      first_team_out: outTeam ? { team_id: outTeam.team_id, name: outTeam.name, record: outTeam.record, points_for: outTeam.points_for } : null,
      games_gap: inTeam && outTeam ? Math.max(0, inTeam.wins - outTeam.wins) : null,
      points_gap: inTeam && outTeam ? fromCents(toCents(inTeam.points_for) - toCents(outTeam.points_for)) : null,
      decisions_remaining: remainingWeeks * (medianScoring ? 2 : 1)
    }
  };
}