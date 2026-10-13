import { fromCents, toCents, roundHalfUp } from './numbers.js';

function playerSlot(player) {
  return player.lineup_slot ?? player.slot_position ?? null;
}

function playerPoints(player) {
  if (player.points == null || player.points === '') return null;
  const value = Number(player.points);
  return Number.isFinite(value) ? toCents(value) : null;
}

function isEligible(player, slot) {
  const position = player.position;
  const explicit = slot.eligible_positions ?? [];
  if (explicit.length) return explicit.includes(position);
  if (slot.type === 'FLEX') return ['RB', 'WR', 'TE'].includes(position);
  return slot.slot === position;
}

function slotPriority(slot) {
  if (slot.type === 'FLEX') return 3;
  if (['QB', 'D/ST', 'K'].includes(slot.slot)) return 0;
  if (['RB', 'WR', 'TE'].includes(slot.slot)) return 1;
  return 2;
}

export function solveOptimalLineup({ roster = [], lineupSlots = [] }) {
  const available = roster
    .filter((player) => playerSlot(player) !== 'IR' && playerPoints(player) !== null)
    .sort((left, right) => playerPoints(right) - playerPoints(left));
  const starters = roster.filter((player) => !['BE', 'IR'].includes(playerSlot(player)));
  const activeSlots = lineupSlots
    .filter((slot) => ['START', 'FLEX'].includes(slot.type))
    .slice()
    .sort((left, right) => slotPriority(left) - slotPriority(right));
  const remaining = new Set(available);
  const assignment = [];
  let optimalCents = 0;

  for (const slot of activeSlots) {
    const count = Math.max(0, Number(slot.count) || 0);
    for (let index = 0; index < count; index++) {
      const player = [...remaining]
        .filter((candidate) => isEligible(candidate, slot))
        .sort((left, right) => playerPoints(right) - playerPoints(left))[0] ?? null;
      if (player) {
        remaining.delete(player);
        optimalCents += playerPoints(player);
      }
      assignment.push({
        slot: slot.slot,
        player_id: player?.player_id ?? null,
        player: player?.name ?? null,
        position: player?.position ?? null,
        points: player ? fromCents(playerPoints(player)) : 0
      });
    }
  }

  const actualCents = starters.reduce((total, player) => total + (playerPoints(player) ?? 0), 0);
  const swaps = [];
  for (const benchPlayer of roster.filter((player) => playerSlot(player) === 'BE' && playerPoints(player) !== null)) {
    for (const starter of starters) {
      const slot = activeSlots.find((candidate) => candidate.slot === playerSlot(starter) && isEligible(starter, candidate));
      if (!slot || !isEligible(benchPlayer, slot)) continue;
      const gain = playerPoints(benchPlayer) - (playerPoints(starter) ?? 0);
      if (gain > 0) {
        swaps.push({
          bench_player_id: benchPlayer.player_id,
          bench_player: benchPlayer.name,
          starter_player_id: starter.player_id,
          starter_player: starter.name,
          slot: slot.slot,
          gain: fromCents(gain)
        });
      }
    }
  }
  swaps.sort((left, right) => right.gain - left.gain || String(left.bench_player).localeCompare(String(right.bench_player)));

  const optimalPoints = fromCents(optimalCents);
  const actualPoints = fromCents(actualCents);
  return {
    assignment,
    optimal_points: optimalPoints,
    actual_points: actualPoints,
    left_on_bench: fromCents(optimalCents - actualCents),
    efficiency: optimalCents ? roundHalfUp(actualCents / optimalCents, 2) : 0,
    swaps
  };
}

export function analyzeLineups({ teams, rostersByTeam, lineupSlots, weekScoring, medianScoring = true }) {
  const scoreById = new Map(weekScoring.rows.map((row) => [row.team_id, row]));
  const matchupOpponent = new Map();
  for (const matchup of weekScoring.matchups) {
    matchupOpponent.set(matchup.home_team_id, matchup.away_team_id);
    matchupOpponent.set(matchup.away_team_id, matchup.home_team_id);
  }
  const rows = teams.map((team) => {
    const analysis = solveOptimalLineup({ roster: rostersByTeam.get(team.team_id) ?? [], lineupSlots });
    const actual = scoreById.get(team.team_id);
    const opponent = scoreById.get(matchupOpponent.get(team.team_id));
    const optimalScore = toCents(analysis.optimal_points);
    const currentScore = toCents(actual?.score);
    const opponentScore = toCents(opponent?.score);
    const optimalH2h = opponent ? (optimalScore > opponentScore ? 'W' : optimalScore < opponentScore ? 'L' : 'T') : null;
    const medianCents = weekScoring._median_cents ?? toCents(weekScoring.median);
    const optimalMedian = medianScoring && weekScoring.median != null
      ? (optimalScore > medianCents ? 'W' : 'L')
      : null;
    return {
      team_id: team.team_id,
      name: team.team_name ?? team.name,
      ...analysis,
      what_ifs: {
        h2h_changed: Boolean(actual && optimalH2h !== actual.h2h_result),
        h2h_result_if_optimal: optimalH2h,
        h2h_margin_if_optimal: opponent ? fromCents(optimalScore - opponentScore) : null,
        median_changed: medianScoring ? Boolean(actual && optimalMedian !== actual.median_result) : null,
        median_result_if_optimal: optimalMedian,
        median_margin_if_optimal: medianScoring && weekScoring.median != null
          ? fromCents(optimalScore - medianCents)
          : null
      }
    };
  });
  return {
    teams: rows,
    league_total_left: fromCents(rows.reduce((total, row) => total + toCents(row.left_on_bench), 0)),
    what_ifs: rows.filter((row) => row.what_ifs.h2h_changed || row.what_ifs.median_changed)
      .map(({ team_id, name, what_ifs }) => ({ team_id, name, ...what_ifs }))
  };
}