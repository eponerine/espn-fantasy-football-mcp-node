/**
 * Cross-references a roster against the league's actual lineup slots and player
 * availability. ESPN's eligible_slots is authoritative for what a player may fill,
 * so slot legality is checked against it rather than against position labels.
 */

const BENCH_SLOT = 'BE';
const IR_SLOT = 'IR';

// ESPN only permits these designations in an IR slot; anything else blocks lineup submission.
const IR_ELIGIBLE_STATUSES = new Set(['OUT', 'INJURY_RESERVE']);
const UNSTARTABLE_STATUSES = new Set(['OUT', 'DOUBTFUL', 'INJURY_RESERVE', 'SUSPENSION']);
const RISKY_STATUSES = new Set(['QUESTIONABLE', 'DAY_TO_DAY']);

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };

function projectionOf(player) {
  return player.projected_avg_points ?? player.avg_points ?? 0;
}

function describe(player) {
  return `${player.name} (${player.position}, ${player.pro_team})`;
}

export function analyzeLineup({ roster = [], lineupSlots, week }) {
  if (!Array.isArray(lineupSlots) || lineupSlots.length === 0) {
    return {
      week,
      analyzed: false,
      reason:
        'League lineup_slots are unavailable, so lineup legality cannot be checked. ' +
        'Upgrade the upstream API to expose settings.lineup_slots.'
    };
  }

  const startingSlots = lineupSlots.filter((slot) => slot.type === 'START' || slot.type === 'FLEX');
  const irCapacity = lineupSlots.find((slot) => slot.type === 'IR')?.count ?? 0;

  const starters = roster.filter((p) => p.lineup_slot !== BENCH_SLOT && p.lineup_slot !== IR_SLOT);
  const bench = roster.filter((p) => p.lineup_slot === BENCH_SLOT);
  const onIr = roster.filter((p) => p.lineup_slot === IR_SLOT);

  const issues = [];

  // If every player reads as on-bye, the upstream schedule data is missing, not the NFL calendar.
  const byeDataSuspect = roster.length > 0 && roster.every((p) => p.on_bye_week === true);
  if (byeDataSuspect) {
    issues.push({
      severity: 'warning',
      type: 'bye_data_unreliable',
      message:
        'Every player on this roster reports on_bye_week=true, which means pro schedule data is ' +
        'missing for this week rather than the whole roster being on bye. Bye-week checks were skipped.'
    });
  }

  for (const requirement of startingSlots) {
    const filled = starters.filter((p) => p.lineup_slot === requirement.slot).length;
    if (filled < requirement.count) {
      issues.push({
        severity: 'error',
        type: 'empty_slot',
        slot: requirement.slot,
        message: `${requirement.slot} has ${filled} of ${requirement.count} slots filled. Empty slots score zero.`,
        eligible_positions: requirement.eligible_positions
      });
    }
  }

  if (!byeDataSuspect) {
    for (const player of starters.filter((p) => p.on_bye_week === true)) {
      issues.push({
        severity: 'error',
        type: 'bye_week_starter',
        player: player.name,
        slot: player.lineup_slot,
        message: `${describe(player)} is on bye and will score zero in the ${player.lineup_slot} slot.`
      });
    }
  }

  for (const player of starters.filter((p) => UNSTARTABLE_STATUSES.has(p.injury_status))) {
    issues.push({
      severity: 'error',
      type: 'unstartable_starter',
      player: player.name,
      slot: player.lineup_slot,
      injury_status: player.injury_status,
      message: `${describe(player)} is ${player.injury_status} but is starting at ${player.lineup_slot}.`
    });
  }

  for (const player of starters.filter((p) => RISKY_STATUSES.has(p.injury_status))) {
    issues.push({
      severity: 'warning',
      type: 'questionable_starter',
      player: player.name,
      slot: player.lineup_slot,
      injury_status: player.injury_status,
      message: `${describe(player)} is ${player.injury_status}. Confirm active status before kickoff.`
    });
  }

  for (const player of onIr.filter((p) => !IR_ELIGIBLE_STATUSES.has(p.injury_status))) {
    issues.push({
      severity: 'error',
      type: 'illegal_ir',
      player: player.name,
      injury_status: player.injury_status ?? 'ACTIVE',
      message:
        `${describe(player)} occupies an IR slot but is ${player.injury_status ?? 'ACTIVE'}. ` +
        'ESPN blocks lineup submission until an ineligible player is moved off IR.'
    });
  }

  const openIrSlots = irCapacity - onIr.length;
  if (openIrSlots > 0) {
    for (const player of bench.filter((p) => IR_ELIGIBLE_STATUSES.has(p.injury_status))) {
      issues.push({
        severity: 'info',
        type: 'ir_stash_available',
        player: player.name,
        injury_status: player.injury_status,
        message:
          `${describe(player)} is ${player.injury_status} and IR-eligible while ${openIrSlots} IR slot(s) ` +
          'sit open. Moving him to IR frees a bench spot at no cost.'
      });
    }
  }

  const availableBench = bench.filter(
    (p) => !UNSTARTABLE_STATUSES.has(p.injury_status) && p.on_bye_week !== true
  );
  for (const benchPlayer of availableBench) {
    const eligible = new Set(benchPlayer.eligible_slots || []);
    const beatable = starters
      .filter((starter) => eligible.has(starter.lineup_slot))
      .filter((starter) => projectionOf(benchPlayer) > projectionOf(starter));

    if (beatable.length === 0) continue;

    const weakest = beatable.reduce((low, s) => (projectionOf(s) < projectionOf(low) ? s : low));
    issues.push({
      severity: 'warning',
      type: 'bench_upgrade',
      player: benchPlayer.name,
      replaces: weakest.name,
      slot: weakest.lineup_slot,
      message:
        `${describe(benchPlayer)} averages ${projectionOf(benchPlayer).toFixed(1)} vs ` +
        `${projectionOf(weakest).toFixed(1)} for ${describe(weakest)} in the ${weakest.lineup_slot} slot.`
    });
  }

  issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const counts = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) counts[issue.severity] += 1;

  return {
    week,
    analyzed: true,
    lineup_is_legal: counts.error === 0,
    issue_counts: counts,
    issues,
    roster_shape: {
      starters: starters.length,
      bench: bench.length,
      on_ir: onIr.length,
      ir_capacity: irCapacity
    },
    projection_basis:
      'Comparisons use season average points per game (projected_avg_points, falling back to ' +
      'avg_points), not this week\'s matchup projection. For true weekly projections call ' +
      'get_box_scores with includeLineup=true.'
  };
}
