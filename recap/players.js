import { fromCents, toCents } from './numbers.js';

function getWeekPlayers(weeks) {
  const rows = [];
  for (const week of weeks) {
    for (const team of week.teams) {
      for (const player of team.players) {
        rows.push({ ...player, team_id: team.team_id, team_name: team.team_name, week: week.week });
      }
    }
  }
  return rows;
}

function priorPointsLookup(weeks, selectedWeek) {
  const byPlayer = new Map();
  for (const week of weeks) {
    if (week.week >= selectedWeek) continue;
    for (const team of week.teams) {
      for (const player of team.players) {
        if (player.player_id == null || player.points == null) continue;
        if (!byPlayer.has(player.player_id)) byPlayer.set(player.player_id, new Map());
        byPlayer.get(player.player_id).set(week.week, Number(player.points));
      }
    }
  }
  return byPlayer;
}

function addCallbacks(player, priorPoints) {
  const history = priorPoints.get(player.player_id) ?? new Map();
  const priorWeek = history.get(player.week - 1) ?? null;
  const lastThree = [];
  for (let week = Math.max(1, player.week - 3); week < player.week; week++) {
    if (history.has(week)) lastThree.push({ week, points: history.get(week) });
  }
  return { ...player, prior_week_points: priorWeek, last_3_weeks: lastThree };
}

export function analyzePlayers({ week, weeklyData, limit = 8 }) {
  const all = getWeekPlayers(weeklyData);
  const current = all.filter((player) => player.week === week && player.points != null);
  const prior = priorPointsLookup(weeklyData, week);
  const starters = current.filter((player) => !['BE', 'IR'].includes(player.lineup_slot ?? player.slot_position));
  const bench = current.filter((player) => (player.lineup_slot ?? player.slot_position) === 'BE');
  const leagueRanks = new Map();
  const scores = [...current].sort((left, right) => Number(right.points) - Number(left.points));
  for (const player of scores) {
    leagueRanks.set(player.player_id, 1 + scores.filter((other) => Number(other.points) > Number(player.points)).length);
  }

  const studs = [...starters].sort((left, right) => Number(right.points) - Number(left.points))
    .slice(0, limit).map((player) => {
      const projection = player.projected_points == null || player.projected_points === ''
        ? NaN
        : Number(player.projected_points);
      return addCallbacks({
        player_id: player.player_id,
        player: player.name,
        team_id: player.team_id,
        team: player.team_name,
        position: player.position,
        points: Number(player.points),
        projected_points: Number.isFinite(projection) ? projection : null,
        projection_delta: Number.isFinite(projection) ? fromCents(toCents(player.points) - toCents(projection)) : null
      }, prior);
    });

  const duds = starters.filter((player) => player.projected_points != null && player.projected_points !== '' && Number.isFinite(Number(player.projected_points)))
    .sort((left, right) => (Number(left.points) - Number(left.projected_points)) - (Number(right.points) - Number(right.projected_points)))
    .slice(0, limit).map((player) => addCallbacks({
      player_id: player.player_id,
      player: player.name,
      team_id: player.team_id,
      team: player.team_name,
      position: player.position,
      points: Number(player.points),
      projected_points: Number(player.projected_points),
      projection_delta: fromCents(toCents(player.points) - toCents(player.projected_points))
    }, prior));

  const benchTop = [...bench].sort((left, right) => Number(right.points) - Number(left.points))
    .slice(0, limit).map((player) => addCallbacks({
      player_id: player.player_id,
      player: player.name,
      team_id: player.team_id,
      team: player.team_name,
      position: player.position,
      points: Number(player.points),
      league_score_rank: leagueRanks.get(player.player_id)
    }, prior));

  const playersByWeekAndTeam = new Map();
  for (const entry of weeklyData) {
    for (const team of entry.teams) {
      const key = `${entry.week}:${team.team_id}`;
      playersByWeekAndTeam.set(key, team.players);
    }
  }
  const priorWeekData = weeklyData.find((entry) => entry.week === week - 1);
  const currentWeekData = weeklyData.find((entry) => entry.week === week);
  const previousQb = new Map();
  for (const team of priorWeekData?.teams ?? []) {
    previousQb.set(team.team_id, team.players.find((player) => player.position === 'QB' && (player.lineup_slot ?? player.slot_position) === 'QB') ?? null);
  }
  const qbFlips = [];
  for (const team of currentWeekData?.teams ?? []) {
    const currentQb = team.players.find((player) => player.position === 'QB' && (player.lineup_slot ?? player.slot_position) === 'QB') ?? null;
    const oldQb = previousQb.get(team.team_id);
    if (!oldQb || !currentQb || oldQb.player_id === currentQb.player_id) continue;
    const currentPlayers = playersByWeekAndTeam.get(`${week}:${team.team_id}`) ?? [];
    const previousStarterThisWeek = currentPlayers.find((player) => player.player_id === oldQb.player_id);
    qbFlips.push({
      team_id: team.team_id,
      team: team.team_name,
      previous_qb: oldQb.name,
      previous_qb_prior_week_points: Number(oldQb.points),
      previous_qb_week_points: previousStarterThisWeek?.points == null ? null : Number(previousStarterThisWeek.points),
      current_qb: currentQb.name,
      current_qb_points: Number(currentQb.points),
      swap_gain: previousStarterThisWeek?.points == null
        ? null
        : fromCents(toCents(currentQb.points) - toCents(previousStarterThisWeek.points))
    });
  }

  return { studs, duds, bench_top: benchTop, qb_flips: qbFlips };
}