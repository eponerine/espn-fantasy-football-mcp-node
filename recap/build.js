import { buildAvailability } from './availability.js';
import { analyzeLineups } from './lineups.js';
import { fromCents, toCents } from './numbers.js';
import { analyzePlayers } from './players.js';
import { buildRosterDetails, SCHEMA_VERSION } from './payload.js';
import { calculatePowerRankings } from './rankings.js';
import { calculateSeasonRecords, calculateWeekScoring } from './scoring.js';
import { calculateStandings } from './standings.js';
import { summarizeTransactions } from './transactions.js';
import { validateRecap } from './validate.js';

function getCollection(payload, key) {
  if (Array.isArray(payload)) return payload;
  return payload?.[key] ?? [];
}

function normalizeWeeklyData({ teams, boxScoresByWeek, nameToId, medianScoring }) {
  const weeks = [];
  const weeklyPlayerData = [];
  const unresolvedNames = new Set();
  for (let week = 1; week <= boxScoresByWeek.length; week++) {
    const payload = boxScoresByWeek[week - 1];
    const rawMatchups = getCollection(payload, 'box_scores');
    const matchups = [];
    const teamPlayers = new Map();
    for (const game of rawMatchups) {
      const homeId = nameToId.get(game.home_team) ?? null;
      const awayId = nameToId.get(game.away_team) ?? null;
      if (homeId == null) unresolvedNames.add(game.home_team);
      if (awayId == null) unresolvedNames.add(game.away_team);
      if (homeId == null || awayId == null) continue;
      matchups.push({
        home_team_id: homeId,
        away_team_id: awayId,
        home_team: game.home_team,
        away_team: game.away_team,
        home_score: game.home_score,
        away_score: game.away_score,
        is_playoff: game.is_playoff,
        matchup_type: game.matchup_type
      });
      teamPlayers.set(homeId, (game.home_lineup ?? []).map((player) => ({ ...player, lineup_slot: player.slot_position })));
      teamPlayers.set(awayId, (game.away_lineup ?? []).map((player) => ({ ...player, lineup_slot: player.slot_position })));
    }
    const teamRows = teams.map((team) => ({
      team_id: team.team_id,
      team_name: team.team_name ?? team.name,
      players: teamPlayers.get(team.team_id) ?? []
    }));
    const scoring = calculateWeekScoring({ week, teams, matchups, medianScoring });
    weeks.push(scoring);
    weeklyPlayerData.push({ week, teams: teamRows });
  }
  return { weeks, weeklyPlayerData, unresolvedNames: [...unresolvedNames] };
}

function teamPlayerMap(weeklyPlayerData, week) {
  return new Map(weeklyPlayerData.find((entry) => entry.week === week)?.teams.map((team) => [team.team_id, team.players]) ?? []);
}

function rosterPlayerMap(rosterResponses, teams) {
  const responseById = new Map(rosterResponses.map((response) => [response.team_id, response.roster ?? []]));
  return new Map(teams.map((team) => [team.team_id, responseById.get(team.team_id) ?? []]));
}

function callbackFor(playerId, historyById, selectedWeek) {
  const history = historyById.get(playerId) ?? new Map();
  return {
    prior_week_points: history.get(selectedWeek - 1) ?? null,
    last_3_weeks: [...history.entries()].sort((left, right) => left[0] - right[0]).slice(-3)
      .map(([week, points]) => ({ week, points }))
  };
}

function playerHistory(weeklyPlayerData, selectedWeek) {
  const history = new Map();
  for (const week of weeklyPlayerData) {
    if (week.week >= selectedWeek) continue;
    for (const team of week.teams) {
      for (const player of team.players) {
        if (player.player_id == null || player.points == null) continue;
        if (!history.has(player.player_id)) history.set(player.player_id, new Map());
        history.get(player.player_id).set(week.week, Number(player.points));
      }
    }
  }
  return history;
}

function normalizeEspnRanks(payload, teams, nameToId) {
  const rows = getCollection(payload, 'rankings').length
    ? getCollection(payload, 'rankings')
    : getCollection(payload, 'power_rankings').length
      ? getCollection(payload, 'power_rankings')
      : getCollection(payload, 'teams');
  const byId = new Map();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const teamId = row.team_id ?? nameToId.get(row.team_name ?? row.name);
    if (teamId == null || !teams.some((team) => team.team_id === teamId)) continue;
    byId.set(teamId, {
      rank: row.rank ?? row.power_rank ?? index + 1,
      power_score: row.power_score ?? row.score ?? null
    });
  }
  return byId;
}

function ownerDisplayName(team) {
  const direct = team.owner_name ?? team.owner_display_name ?? team.manager_name;
  if (typeof direct === 'string') return direct;
  const candidates = [team.owners, team.members, team.owner].flatMap((value) => Array.isArray(value) ? value : value == null ? [] : [value]);
  const owner = candidates.find((value) => value && typeof value === 'object');
  return owner?.display_name ?? owner?.displayName ?? owner?.name ?? null;
}

function recordHistory(weeks) {
  let best = null;
  let largestMargin = null;
  for (const week of weeks) {
    for (const row of week.rows) {
      if (!best || toCents(row.score) > toCents(best.score)) best = { ...row, week: week.week };
    }
    for (const matchup of week.matchups) {
      const margin = Math.abs(toCents(matchup.home_score) - toCents(matchup.away_score));
      if (!largestMargin || margin > largestMargin.margin_cents) {
        largestMargin = { week: week.week, margin_cents: margin, matchup };
      }
    }
  }
  return { best, largestMargin };
}

function matchupSummary(matchup, teamsById, standingsById, weekRowsById) {
  const home = teamsById.get(matchup.home_team_id);
  const away = teamsById.get(matchup.away_team_id);
  const homeScore = Number(matchup.home_score);
  const awayScore = Number(matchup.away_score);
  const outcome = homeScore > awayScore ? 'W' : homeScore < awayScore ? 'L' : 'T';
  return {
    home_team_id: matchup.home_team_id,
    away_team_id: matchup.away_team_id,
    home_team: home?.team_name ?? home?.name,
    away_team: away?.team_name ?? away?.name,
    home_score: homeScore,
    away_score: awayScore,
    margin: fromCents(Math.abs(toCents(homeScore) - toCents(awayScore))),
    home_result: outcome,
    away_result: outcome === 'W' ? 'L' : outcome === 'L' ? 'W' : 'T',
    home_record: standingsById.get(matchup.home_team_id)?.record ?? null,
    away_record: standingsById.get(matchup.away_team_id)?.record ?? null,
    home_rank: standingsById.get(matchup.home_team_id)?.rank ?? null,
    away_rank: standingsById.get(matchup.away_team_id)?.rank ?? null,
    home_h2h_margin: fromCents(toCents(homeScore) - toCents(awayScore)),
    away_h2h_margin: fromCents(toCents(awayScore) - toCents(homeScore)),
    ...(medianScoringFields(weekRowsById.get(matchup.home_team_id), weekRowsById.get(matchup.away_team_id)))
  };
}

function medianScoringFields(home, away) {
  if (!home || !away || home.median_result == null) return {};
  return {
    home_median_margin: home.median_margin,
    away_median_margin: away.median_margin,
    home_median_result: home.median_result,
    away_median_result: away.median_result,
    home_weekly_record: home.weekly_record,
    away_weekly_record: away.weekly_record
  };
}

export function buildRecapData({
  league,
  settings,
  teams,
  week,
  regularSeason,
  boxScoresByWeek,
  rosterResponses,
  transactions,
  pendingTransactions = [],
  previewMatchups = [],
  espnPowerRankings = [],
  espnPriorPowerRankings = [],
  nameSnapshots = {}
}) {
  const lineupSlots = settings.lineup_slots ?? [];
  const medianScoring = Boolean(settings.median_scoring) && regularSeason;
  const nameToId = new Map();
  for (const team of teams) {
    nameToId.set(team.team_name ?? team.name, team.team_id);
  }
  for (const snapshot of Object.values(nameSnapshots)) {
    for (const [teamId, name] of Object.entries(snapshot)) nameToId.set(name, Number(teamId));
  }
  for (const response of rosterResponses) nameToId.set(response.team_name, response.team_id);

  const normalized = normalizeWeeklyData({ teams, boxScoresByWeek, nameToId, medianScoring });
  const weekResults = normalized.weeks;
  const selectedWeek = weekResults.find((entry) => entry.week === week);
  const weeklyPlayerData = normalized.weeklyPlayerData;
  const priorHistory = playerHistory(weeklyPlayerData, week);
  const rostersByTeam = rosterPlayerMap(rosterResponses, teams);
  const currentPlayersByTeam = teamPlayerMap(weeklyPlayerData, week);
  const rosterDetails = buildRosterDetails({ teams, currentPlayersByTeam, rostersByTeam, lineupSlots });
  const availability = buildAvailability({
    teams,
    rostersByTeam,
    priorWeekPlayersByTeam: currentPlayersByTeam,
    lineupSlots
  });
  availability.slot_week = week + 1;
  availability.week_points_week = week;
  const rosterResponseIds = new Set(rosterResponses.map((response) => response.team_id));
  for (const teamAvailability of availability.teams) {
    teamAvailability.roster_present = rosterResponseIds.has(teamAvailability.team_id);
  }
  const lineupByWeek = weekResults.map((result) => analyzeLineups({
    teams,
    rostersByTeam: teamPlayerMap(weeklyPlayerData, result.week),
    lineupSlots,
    weekScoring: result,
    medianScoring
  }));
  const benchForWeek = lineupByWeek.find((entry, index) => weekResults[index].week === week);
  const benchSeasonTotal = lineupByWeek.reduce((total, analysis) => total + toCents(analysis.league_total_left), 0);
  const players = analyzePlayers({ week, weeklyData: weeklyPlayerData });
  for (const team of benchForWeek.teams) {
    for (const swap of team.swaps) {
      const benchCallback = callbackFor(swap.bench_player_id, priorHistory, week);
      const starterCallback = callbackFor(swap.starter_player_id, priorHistory, week);
      Object.assign(swap, benchCallback, {
        starter_prior_week_points: starterCallback.prior_week_points,
        starter_last_3_weeks: starterCallback.last_3_weeks
      });
    }
  }

  const transactionsSummary = summarizeTransactions({
    transactions,
    teams,
    playersByTeam: currentPlayersByTeam,
    week
  });
  for (const team of transactionsSummary.teams) {
    for (const claim of team.executed_claims) {
      claim.prior_week_points = callbackFor(claim.player_id, priorHistory, week).prior_week_points;
    }
  }

  const standingsResult = regularSeason
    ? calculateStandings({
      teams,
      weeks: weekResults,
      week,
      medianScoring,
      regularSeasonWeeks: settings.reg_season_count,
      playoffTeamCount: settings.playoff_team_count
    })
    : { standings: [], all_play: { rows: [], total_wins: 0, total_losses: 0 }, cut_line: null };
  const standings = standingsResult.standings;
  const priorWeekCount = weekResults.filter((entry) => entry.week < week).length;
  const currentRankingsPayload = normalizeEspnRanks(espnPowerRankings, teams, nameToId);
  const priorRankingsPayload = normalizeEspnRanks(espnPriorPowerRankings, teams, nameToId);
  const rankings = regularSeason
    ? calculatePowerRankings({ teams, weeks: weekResults, week, medianScoring, espnRankById: currentRankingsPayload })
    : [];
  const previousRankings = regularSeason && priorWeekCount > 0
    ? calculatePowerRankings({ teams, weeks: weekResults, week: week - 1, medianScoring, espnRankById: priorRankingsPayload })
    : [];
  const teamsById = new Map(teams.map((team) => [team.team_id, team]));
  const standingsById = new Map(standings.map((row) => [row.team_id, row]));
  const rankingById = new Map(rankings.map((row) => [row.team_id, row]));
  const selectedWeekRowsById = new Map(selectedWeek.rows.map((row) => [row.team_id, row]));
  const scoreboard = selectedWeek.matchups.map((matchup) =>
    matchupSummary(matchup, teamsById, standingsById, selectedWeekRowsById)
  );
  const orderedStandings = [...standings];
  const currentSeason = calculateSeasonRecords(weekResults);
  const previousSeason = calculateSeasonRecords(weekResults.filter((entry) => entry.week < week));
  const previousRecord = previousSeason.high;
  const currentRecord = currentSeason.high;
  const previousMargin = recordHistory(weekResults.filter((entry) => entry.week < week)).largestMargin;
  const seasonMargin = recordHistory(weekResults).largestMargin;
  const margins = scoreboard.map((matchup) => matchup.margin).sort((left, right) => left - right);
  const currentRows = selectedWeek.rows;
  const topScorer = [...currentRows].sort((left, right) => right.score - left.score)[0] ?? null;
  const lowScorer = [...currentRows].sort((left, right) => left.score - right.score)[0] ?? null;
  const closestMatchup = scoreboard.reduce((closest, matchup) => !closest || matchup.margin < closest.margin ? matchup : closest, null);
  const widestCurrent = scoreboard.reduce((widest, matchup) => !widest || matchup.margin > widest.margin ? matchup : widest, null);
  const recordsDistribution = medianScoring
    ? { '2-0': 0, '1-1': 0, '0-2': 0 }
    : { '1-0': 0, '0-1': 0, '0-0': 0 };
  for (const row of selectedWeek.rows) {
    const key = `${row.weekly_record.wins}-${row.weekly_record.losses}`;
    if (key in recordsDistribution) recordsDistribution[key]++;
  }
  const weekTotalCents = currentRows.reduce((total, row) => total + toCents(row.score), 0);
  const priorTotalCents = weekResults.find((entry) => entry.week === week - 1)?.rows.reduce((total, row) => total + toCents(row.score), 0) ?? null;
  const medianClose = medianScoring
    ? currentRows.filter((row) => Math.abs(toCents(row.score) - toCents(selectedWeek.median)) <= 150).length
    : null;
  const luckSorted = [...standings].sort((left, right) => right.luck_delta - left.luck_delta);
  const seasonSummary = {
    luckiest: luckSorted[0] ?? null,
    unluckiest: luckSorted.length ? luckSorted.filter((row) => row.luck_delta === luckSorted.at(-1).luck_delta) : [],
    cut_line: standingsResult.cut_line
  };
  const validation = validateRecap({
    teams,
    weeks: weekResults,
    standings,
    benchAnalysis: benchForWeek,
    availability,
    medianScoring,
    regularSeason
  });
  validation.checks.push({
    name: 'team_name_resolution',
    expected: [],
    actual: normalized.unresolvedNames,
    passed: normalized.unresolvedNames.length === 0
  });
  validation.passed = validation.checks.every((entry) => entry.passed);

  const weeklySummary = {
    total_points: fromCents(weekTotalCents),
    average_points: fromCents(weekTotalCents / Math.max(1, teams.length)),
    change_from_prior_week: priorTotalCents == null ? null : fromCents(weekTotalCents - priorTotalCents),
    average_change_from_prior_week: priorTotalCents == null ? null
      : fromCents(weekTotalCents / Math.max(1, teams.length) - priorTotalCents / Math.max(1, teams.length)),
    ...(medianScoring ? { median: selectedWeek.median } : {}),
    records_distribution: recordsDistribution,
    bench_points_week: benchForWeek.league_total_left,
    bench_points_season: fromCents(benchSeasonTotal),
    week_high: topScorer ? { team_id: topScorer.team_id, team: topScorer.name, score: topScorer.score } : null,
    week_low: lowScorer ? { team_id: lowScorer.team_id, team: lowScorer.name, score: lowScorer.score } : null,
    season_high: currentRecord,
    previous_season_high: previousRecord,
    season_low: currentSeason.low,
    closest_margin: closestMatchup,
    largest_margin: seasonMargin ? { week: seasonMargin.week, margin: fromCents(seasonMargin.margin_cents), matchup: seasonMargin.matchup } : null,
    previous_largest_margin: previousMargin ? { week: previousMargin.week, margin: fromCents(previousMargin.margin_cents), matchup: previousMargin.matchup } : null,
    ...(medianScoring ? { teams_within_1_5_of_median: medianClose } : {}),
    biggest_margin_this_week: widestCurrent,
    cruelest_number: scoreboard.filter((matchup) => matchup.home_result === 'L' || matchup.away_result === 'L')
      .map((matchup) => ({ team_id: matchup.home_result === 'L' ? matchup.home_team_id : matchup.away_team_id,
        team: matchup.home_result === 'L' ? matchup.home_team : matchup.away_team,
        score: matchup.home_result === 'L' ? matchup.home_score : matchup.away_score }))
      .sort((left, right) => right.score - left.score)[0] ?? null
  };

  let preview = [];
  if (regularSeason && previewMatchups.length) {
    const bubbleWins = standingsResult.cut_line?.last_team_in
      ? standings.find((row) => row.team_id === standingsResult.cut_line.last_team_in.team_id)?.wins ?? null
      : null;
    preview = previewMatchups.map((matchup) => {
      const homeId = nameToId.get(matchup.home_team) ?? null;
      const awayId = nameToId.get(matchup.away_team) ?? null;
      const home = standingsById.get(homeId);
      const away = standingsById.get(awayId);
      const homeRanking = rankingById.get(homeId);
      const awayRanking = rankingById.get(awayId);
      const closeToCut = (team) => team && bubbleWins != null && Math.abs(team.wins - bubbleWins) <= 1;
      return {
        week: week + 1,
        home_team_id: homeId,
        away_team_id: awayId,
        home_team: matchup.home_team,
        away_team: matchup.away_team,
        teams: [home, away].map((standing, index) => ({
          team_id: standing?.team_id ?? null,
          name: standing?.name ?? null,
          record: standing?.record ?? null,
          points_for: standing?.points_for ?? null,
          all_play: standing?.all_play ?? null,
          espn_power_score: (index === 0 ? homeRanking : awayRanking)?.espn_power_score ?? null,
          availability: { team_id: index === 0 ? homeId : awayId }
        })),
        bubble_game: Boolean(closeToCut(home) && closeToCut(away)),
        winless_matchup: Boolean(home?.wins === 0 && away?.wins === 0)
      };
    });
  }

  const outputTeams = teams.map((team) => {
    const currentName = team.team_name ?? team.name;
    const oldName = nameSnapshots[String(week - 1)]?.[String(team.team_id)] ?? null;
    return {
      team_id: team.team_id,
      name: currentName,
      display_name: currentName?.trim() ?? null,
      abbreviation: team.team_abbrev ?? team.abbreviation ?? null,
      owner_name: ownerDisplayName(team),
      renamed_from: oldName && oldName !== currentName ? oldName : null
    };
  });

  return {
    schema_version: SCHEMA_VERSION,
    name_snapshot: Object.fromEntries(teams.map((team) => [String(team.team_id), team.team_name ?? team.name])),
    meta: {
      league_id: league.league_id ?? null,
      season: league.year ?? league.season ?? null,
      week,
      generated_at: new Date().toISOString(),
      regular_season: regularSeason
    },
    teams: outputTeams,
    week_summary: weeklySummary,
    scoreboard,
    standings: orderedStandings,
    season_summary: seasonSummary,
    players: {
      ...players,
      studs: players.studs.map((player) => ({ ...player, team: teamsById.get(player.team_id)?.team_name ?? player.team })),
      duds: players.duds.map((player) => ({ ...player, team: teamsById.get(player.team_id)?.team_name ?? player.team })),
      bench_top: players.bench_top.map((player) => ({ ...player, team: teamsById.get(player.team_id)?.team_name ?? player.team }))
    },
    bench_analysis: benchForWeek,
    ...rosterDetails,
    roster_moves: transactionsSummary,
    pending_claims: pendingTransactions.filter((transaction) =>
      ['WAIVER', 'FREEAGENT'].includes(transaction.type)
      && ['PENDING', 'CANCELED', 'CANCELLED'].includes(transaction.status)
      && Number(transaction.scoring_period ?? week + 1) === week + 1)
      .map((transaction) => ({ ...transaction, scoring_period: week + 1 })),
    injuries_and_byes: availability,
    power_rankings: rankings.map((rank) => ({ ...rank, team: teamsById.get(rank.team_id)?.team_name ?? rank.team })),
    prior_power_rankings: previousRankings,
    preview,
    validation
  };
}