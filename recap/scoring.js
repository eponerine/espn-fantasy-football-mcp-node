import { fromCents, toCents } from './numbers.js';

function resultFor(score, opponentScore) {
  if (score > opponentScore) return 'W';
  if (score < opponentScore) return 'L';
  return 'T';
}

function recordValue(result) {
  return { wins: Number(result === 'W'), losses: Number(result === 'L'), ties: Number(result === 'T') };
}

export function calculateWeekScoring({ week, teams, matchups, medianScoring = true }) {
  const scores = new Map();
  const opponents = new Map();
  for (const matchup of matchups) {
    const home = toCents(matchup.home_score);
    const away = toCents(matchup.away_score);
    scores.set(matchup.home_team_id, home);
    scores.set(matchup.away_team_id, away);
    opponents.set(matchup.home_team_id, { team_id: matchup.away_team_id, score: away });
    opponents.set(matchup.away_team_id, { team_id: matchup.home_team_id, score: home });
  }

  const rankedScores = [...scores.values()].sort((left, right) => right - left);
  const middle = Math.floor(rankedScores.length / 2);
  const medianCents = rankedScores.length % 2
    ? rankedScores[middle]
    : (rankedScores[middle - 1] + rankedScores[middle]) / 2;

  const rows = teams.map((team) => {
    const score = scores.get(team.team_id) ?? 0;
    const opponent = opponents.get(team.team_id);
    const h2h = opponent ? resultFor(score, opponent.score) : null;
    const h2hRecord = recordValue(h2h);
    const row = {
      team_id: team.team_id,
      name: team.team_name ?? team.name,
      score: fromCents(score),
      rank: 1 + rankedScores.filter((other) => other > score).length,
      h2h_result: h2h,
      h2h_margin: opponent ? fromCents(score - opponent.score) : null,
      weekly_record: {
        wins: h2hRecord.wins,
        losses: h2hRecord.losses,
        ties: h2hRecord.ties
      },
      _score_cents: score,
      _h2h_opponent_id: opponent?.team_id ?? null
    };
    if (medianScoring) {
      const medianResult = score > medianCents ? 'W' : 'L';
      const medianRecord = recordValue(medianResult);
      row.median_margin = fromCents(score - medianCents);
      row.median_result = medianResult;
      row.weekly_record.wins += medianRecord.wins;
      row.weekly_record.losses += medianRecord.losses;
    }
    return row;
  });

  const result = { week, rows, matchups: matchups.map((matchup) => ({ ...matchup })) };
  if (medianScoring) {
    result.median = fromCents(medianCents);
    result._median_cents = medianCents;
  }
  return result;
}

export function calculateSeasonRecords(weeks) {
  let high = null;
  let low = null;
  const byWeek = [];
  for (const week of weeks) {
    const weekHigh = [...week.rows].sort((a, b) => b.score - a.score)[0] ?? null;
    const weekLow = [...week.rows].sort((a, b) => a.score - b.score)[0] ?? null;
    if (weekHigh && (!high || toCents(weekHigh.score) > toCents(high.score))) {
      high = { week: week.week, team_id: weekHigh.team_id, name: weekHigh.name, score: weekHigh.score };
    }
    if (weekLow && (!low || toCents(weekLow.score) < toCents(low.score))) {
      low = { week: week.week, team_id: weekLow.team_id, name: weekLow.name, score: weekLow.score };
    }
    const totalCents = week.rows.reduce((total, row) => total + toCents(row.score), 0);
    byWeek.push({
      week: week.week,
      total_points: fromCents(totalCents),
      average_points: week.rows.length ? fromCents(totalCents / week.rows.length) : 0,
      high: weekHigh ? { team_id: weekHigh.team_id, name: weekHigh.name, score: weekHigh.score } : null,
      low: weekLow ? { team_id: weekLow.team_id, name: weekLow.name, score: weekLow.score } : null
    });
  }
  return { high, low, by_week: byWeek };
}