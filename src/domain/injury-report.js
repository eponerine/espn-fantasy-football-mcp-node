/**
 * Builds a weekly injury report for the season's top fantasy scorers. Statuses are read at
 * report time; the player card game log is used to work out when the injury showed up.
 */

const HEALTHY_STATUSES = new Set(['ACTIVE', 'NORMAL']);
const UNAVAILABLE_STATUSES = new Set(['OUT', 'DOUBTFUL', 'INJURY_RESERVE', 'SUSPENSION']);
const NON_STARTING_SLOTS = new Set(['BE', 'IR']);
const LOOKBACK_WEEKS = 3;

export function isHealthy(status) {
  return status == null || status === '' || HEALTHY_STATUSES.has(status);
}

/** Ranks every rostered player by season points and returns the top N with owner info. */
export function rankTopPlayers(rosters, topN = 100) {
  const pool = [];
  for (const { team_id, team_name, roster = [] } of rosters) {
    for (const player of roster) {
      pool.push({ ...player, team_id, team_name });
    }
  }
  pool.sort((a, b) => (b.total_points ?? 0) - (a.total_points ?? 0));

  const positionCounts = {};
  return pool.slice(0, topN).map((player, index) => {
    positionCounts[player.position] = (positionCounts[player.position] ?? 0) + 1;
    return { ...player, ytd_rank: index + 1, ytd_position_rank: positionCounts[player.position] };
  });
}

function weekLine(card, week) {
  const key = String(week);
  const stats = card?.stats?.[key] ?? {};
  const hadGame = Object.prototype.hasOwnProperty.call(card?.schedule ?? {}, key);
  const played = Object.keys(stats.breakdown ?? {}).length > 0;
  return {
    week,
    had_game: hadGame,
    played,
    points: stats.points ?? null,
    projected_points: stats.projected_points ?? null
  };
}

/**
 * Classifies when an injury surfaced relative to the recap week using the game log:
 * played the recap week, missed it after playing the prior game, or has been out longer.
 */
export function classifyInjuryTiming(card, recapWeek) {
  if (!card) return { timing: 'unknown', is_new_this_week: null, game_log: [] };

  const gameLog = [];
  for (let week = Math.max(1, recapWeek - LOOKBACK_WEEKS + 1); week <= recapWeek; week += 1) {
    gameLog.push(weekLine(card, week));
  }
  const recap = gameLog[gameLog.length - 1];
  const previousGame = gameLog.slice(0, -1).reverse().find((line) => line.had_game);

  if (!recap.had_game) {
    return { timing: 'bye_in_recap_week', is_new_this_week: null, game_log: gameLog };
  }

  if (recap.played) {
    const underperformed =
      recap.projected_points > 0 && recap.points != null && recap.points < recap.projected_points * 0.5;
    return {
      timing: underperformed ? 'likely_hurt_in_recap_week_game' : 'designated_after_playing_recap_week',
      is_new_this_week: true,
      game_log: gameLog
    };
  }

  if (!previousGame || previousGame.played) {
    return { timing: 'missed_recap_week', is_new_this_week: true, game_log: gameLog };
  }

  return { timing: 'ongoing_absence', is_new_this_week: false, game_log: gameLog };
}

function benchOptions(teamRoster, injured) {
  return teamRoster
    .filter((p) => p.player_id !== injured.player_id && p.lineup_slot === 'BE')
    .filter((p) => !UNAVAILABLE_STATUSES.has(p.injury_status))
    .filter((p) => (p.eligible_slots ?? []).includes(injured.position))
    .sort((a, b) => (b.avg_points ?? 0) - (a.avg_points ?? 0))
    .slice(0, 3)
    .map((p) => ({
      name: p.name,
      position: p.position,
      avg_points: p.avg_points,
      injury_status: p.injury_status ?? 'ACTIVE'
    }));
}

export function buildInjuryReport({ rosters, topPlayers, playerCards = new Map(), recapWeek, currentWeek, asOf }) {
  const rosterByTeam = new Map(rosters.map((r) => [r.team_id, r.roster ?? []]));
  const injuredTop = topPlayers.filter((p) => !isHealthy(p.injury_status));

  const injuredPlayers = injuredTop.map((player) => {
    const card = playerCards.get(player.player_id) ?? null;
    const timing = classifyInjuryTiming(card, recapWeek);
    return {
      ytd_rank: player.ytd_rank,
      ytd_position_rank: `${player.position}${player.ytd_position_rank}`,
      name: player.name,
      player_id: player.player_id,
      position: player.position,
      pro_team: player.pro_team,
      injury_status: player.injury_status,
      fantasy_team_id: player.team_id,
      fantasy_team_name: player.team_name,
      current_lineup_slot: player.lineup_slot,
      season_points: player.total_points,
      avg_points: player.avg_points,
      injury_timing: timing.timing,
      is_new_this_week: timing.is_new_this_week,
      game_log: timing.game_log,
      ...(card ? {} : { note: 'Player card unavailable; injury timing could not be determined.' })
    };
  });

  const byTeam = rosters
    .map(({ team_id, team_name }) => {
      const injured = injuredPlayers.filter((p) => p.fantasy_team_id === team_id);
      return {
        team_id,
        team_name,
        injured_players: injured.map((p) => `${p.name} (${p.position}, ${p.injury_status})`),
        positions_to_fill: injured.map((p) => {
          const options = benchOptions(rosterByTeam.get(team_id) ?? [], p);
          return {
            position: p.position,
            injured_player: p.name,
            injury_status: p.injury_status,
            currently_in_lineup: !NON_STARTING_SLOTS.has(p.current_lineup_slot),
            bench_options: options,
            needs_waiver_help: options.length === 0
          };
        })
      };
    })
    .filter((team) => team.injured_players.length > 0);

  const injuredTeamIds = new Set(byTeam.map((t) => t.team_id));

  return {
    recap_week: recapWeek,
    current_week: currentWeek,
    status_as_of: asOf,
    status_basis:
      'injury_status is the designation at the time this report ran, not on game day of the recap week.',
    pool: {
      top_n: topPlayers.length,
      cutoff_season_points: topPlayers.at(-1)?.total_points ?? null,
      basis: 'Rostered players ranked by season-to-date fantasy points in this league\'s scoring.'
    },
    injured_count: injuredPlayers.length,
    new_this_week_count: injuredPlayers.filter((p) => p.is_new_this_week).length,
    injured_players: injuredPlayers,
    by_team: byTeam,
    healthy_teams: rosters.filter((r) => !injuredTeamIds.has(r.team_id)).map((r) => r.team_name),
    injury_timing_legend: {
      likely_hurt_in_recap_week_game: 'Played the recap week but scored under half of projection — likely hurt during the game.',
      designated_after_playing_recap_week: 'Played the recap week normally, designation appeared afterwards (practice report or late-game knock).',
      missed_recap_week: 'Played his previous game but did not play in the recap week — a new absence.',
      ongoing_absence: 'Missed the recap week and his previous game too — not a new injury.',
      bye_in_recap_week: 'His NFL team was on bye in the recap week.',
      unknown: 'Game log unavailable.'
    },
    limitations: [
      'Only rostered players are ranked; free agents do not expose season points or injury status upstream, so a top scorer who was dropped will not appear.',
      'The upstream API has no injury news feed. Injury type, severity and expected return are not in this data — confirm them from a news source if one is available, otherwise do not state them.'
    ]
  };
}
