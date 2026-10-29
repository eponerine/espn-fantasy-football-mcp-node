const INJURY_STATUSES = new Set(['QUESTIONABLE', 'DOUBTFUL', 'OUT', 'DAY_TO_DAY', 'INJURY_RESERVE']);

function slotOf(player) {
  return player.lineup_slot ?? player.slot_position ?? null;
}

function onBye(player) {
  return Boolean(player.pro_team && String(player.pro_team).trim().toLowerCase() !== 'none' && player.on_bye_week === true);
}

function healthyBenchPlayer(player) {
  const status = String(player.injury_status ?? '').toUpperCase();
  return slotOf(player) === 'BE' && !onBye(player) && status !== 'OUT' && status !== 'INJURY_RESERVE';
}

function eligible(player, slot) {
  const positions = slot.eligible_positions?.length ? slot.eligible_positions : [slot.slot];
  if (slot.type === 'FLEX' && !slot.eligible_positions?.length) return ['RB', 'WR', 'TE'].includes(player.position);
  return positions.includes(player.position);
}

export function buildAvailability({
  teams, rostersByTeam, priorWeekPlayersByTeam, lineupSlots,
  injuries_as_of = new Date().toISOString(), roster_week = null, include_gap_detail = false
}) {
  const byeTeams = new Set();
  const rows = teams.map((team) => {
    const roster = (rostersByTeam.get(team.team_id) ?? [])
      .filter((player) => String(player.pro_team ?? '').trim().toLowerCase() !== 'none');
    const weekPlayers = priorWeekPlayersByTeam.get(team.team_id) ?? [];
    const pointsById = new Map(weekPlayers.map((player) => [player.player_id, player.points]));
    const withWeekPoints = (player) => ({
      player_id: player.player_id,
      player: player.name,
      position: player.position,
      slot: slotOf(player),
      next_week_slot: slotOf(player),
      week_points: pointsById.get(player.player_id) ?? null,
      pro_team: String(player.pro_team ?? '').trim().toLowerCase() === 'none' ? null : player.pro_team ?? null
    });
    const byes = roster.filter(onBye).map((player) => {
      if (player.pro_team) byeTeams.add(player.pro_team);
      return withWeekPoints(player);
    });
    const irPlayers = roster.filter((player) => slotOf(player) === 'IR').map((player) => ({
      ...withWeekPoints(player),
      injury_status: player.injury_status ?? null
    }));
    const injuries = roster.filter((player) => INJURY_STATUSES.has(String(player.injury_status ?? '').toUpperCase()))
      .map((player) => ({ ...withWeekPoints(player), injury_status: String(player.injury_status).toUpperCase() }));
    const starters = roster.filter((player) => !['BE', 'IR'].includes(slotOf(player)));
    const gapDetail = lineupSlots.filter((slot) => ['START', 'FLEX'].includes(slot.type)).map((slot) => {
      const active = starters.filter((player) => slotOf(player) === slot.slot);
      const affected = active.filter((player) => onBye(player) || String(player.injury_status ?? '').toUpperCase() === 'OUT');
      const cover = roster.filter((player) => healthyBenchPlayer(player) && eligible(player, slot));
      const required = Number(slot.count) || 0;
      return {
        slot: slot.slot,
        starter_count: required,
        starters_on_bye_or_out: affected.map((player) => ({ ...withWeekPoints(player), reason: onBye(player) ? 'BYE' : 'OUT' })),
        healthy_bench_eligible: cover.map(withWeekPoints),
        empty_slots: Math.max(0, required - active.length),
        starter_without_healthy_bench_cover: affected.length > 0 && cover.length === 0
      };
    });
    const gaps = include_gap_detail ? gapDetail : gapDetail.filter((gap) =>
      gap.empty_slots > 0 || gap.starter_without_healthy_bench_cover);
    const countPosition = (position) => roster.filter((player) => player.position === position && slotOf(player) !== 'IR').length;
    const positions = new Set(roster.filter((player) => slotOf(player) !== 'IR').map((player) => player.position));
    return {
      team_id: team.team_id,
      team: team.team_name ?? team.name,
      byes,
      injuries,
      ir_players: irPlayers,
      gaps,
      flags: {
        no_qb: !positions.has('QB'),
        only_one_qb: countPosition('QB') === 1,
        only_one_k: countPosition('K') === 1,
        no_k: !positions.has('K'),
        no_dst: !positions.has('D/ST'),
        missing_required_positions: ['QB', 'K', 'D/ST'].filter((position) => !positions.has(position)),
        starter_without_healthy_bench_cover: gaps.some((gap) => gap.starter_without_healthy_bench_cover)
      }
    };
  });
  return {
    injuries_as_of,
    roster_week,
    metadata: {
      slot_alias: 'next_week_slot',
      canonical_slot_field: 'next_week_slot',
      slot_semantics: 'slot and next_week_slot are roster snapshot assignments, not final next-week lineups.'
    },
    bye_teams: [...byeTeams].sort(),
    teams: rows
  };
}