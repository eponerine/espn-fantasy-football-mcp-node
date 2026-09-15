/**
 * Turns ESPN's numeric league settings into a plain-English profile.
 * ESPN expresses scoring as statId/points pairs and lineups as slotId/count pairs;
 * none of that is interpretable without the mappings encoded here.
 */

const RECEPTION_STAT_IDS = [41, 53];
const PASS_TD = 4;
const INT_THROWN = 20;
const RUSH_TD = 25;
const REC_TD = 43;
const FUMBLE_LOST = 72;
const YARDAGE_BONUS_IDS = [17, 18, 37, 38, 56, 57];

const STAT_CATEGORIES = [
  { name: 'passing', max: 22 },
  { name: 'rushing', max: 40 },
  { name: 'receiving', max: 61 },
  { name: 'turnovers_misc', max: 73 },
  { name: 'kicking', max: 88 },
  { name: 'defense_special_teams', max: 154 },
  { name: 'team_result', max: 187 },
  { name: 'other', max: Infinity }
];

function categorize(statId) {
  return STAT_CATEGORIES.find((category) => statId <= category.max).name;
}

function describePpr(value) {
  if (value === 0) return 'Standard (no points per reception)';
  if (value === 0.5) return 'Half-PPR';
  if (value === 1) return 'Full PPR';
  return `Custom: ${value} points per reception`;
}

function buildScoring(scoringFormat) {
  const byId = new Map(scoringFormat.map((item) => [item.id, item]));
  const pointsFor = (id) => byId.get(id)?.points ?? null;

  const receptionId = RECEPTION_STAT_IDS.find((id) => byId.has(id));
  const reception = receptionId != null ? byId.get(receptionId).points : 0;
  const passTd = pointsFor(PASS_TD);
  const intThrown = pointsFor(INT_THROWN);

  const categories = {};
  for (const item of scoringFormat) {
    const category = categorize(item.id);
    categories[category] = categories[category] || [];
    categories[category].push({ stat: item.label, abbr: item.abbr, points: item.points, stat_id: item.id });
  }

  const unmapped = scoringFormat.filter((item) => item.abbr === 'Unknown').map((item) => item.id);
  const activeBonuses = scoringFormat.filter(
    (item) => YARDAGE_BONUS_IDS.includes(item.id) && item.points !== 0
  );

  return {
    format: describePpr(reception),
    points_per_reception: reception,
    passing_td_points: passTd,
    rushing_td_points: pointsFor(RUSH_TD),
    receiving_td_points: pointsFor(REC_TD),
    interception_thrown_points: intThrown,
    fumble_lost_points: pointsFor(FUMBLE_LOST),
    yardage_bonuses_active: activeBonuses.map((item) => `${item.label} (${item.points})`),
    all_scoring_by_category: categories,
    unmapped_stat_ids: unmapped
  };
}

function buildRoster(lineupSlots, positionSlotCounts) {
  if (!Array.isArray(lineupSlots) || lineupSlots.length === 0) {
    return {
      warning:
        'This API build does not expose lineup_slots. Slot counts below may be unreliable; ' +
        'FLEX and IR detection is unavailable.',
      position_slot_counts: positionSlotCounts ?? null
    };
  }

  const starting = lineupSlots.filter((slot) => slot.type === 'START' || slot.type === 'FLEX');
  const bench = lineupSlots.find((slot) => slot.type === 'BENCH');
  const ir = lineupSlots.find((slot) => slot.type === 'IR');
  const flex = lineupSlots.filter((slot) => slot.type === 'FLEX');
  const superflex = flex.find((slot) => slot.slot_id === 7) || null;

  const startingCount = starting.reduce((total, slot) => total + slot.count, 0);
  const benchCount = bench?.count ?? 0;
  const irCount = ir?.count ?? 0;

  return {
    starting_lineup: starting.map((slot) => ({
      slot: slot.slot,
      count: slot.count,
      eligible_positions: slot.eligible_positions,
      is_flex: slot.type === 'FLEX'
    })),
    starting_slot_count: startingCount,
    bench_slots: benchCount,
    ir_slots: irCount,
    total_roster_size: startingCount + benchCount + irCount,
    flex_slot_count: flex.reduce((total, slot) => total + slot.count, 0),
    is_superflex: Boolean(superflex),
    superflex_note: superflex
      ? 'This league has an OP/superflex slot, so a QB may be started in it.'
      : null,
    has_idp: lineupSlots.some((slot) => ['DT', 'DE', 'LB', 'DL', 'CB', 'S', 'DB', 'DP', 'HC'].includes(slot.slot))
  };
}

function buildRules(settings) {
  const firstPlayoffWeek = settings.reg_season_count != null ? settings.reg_season_count + 1 : null;
  return {
    team_count: settings.team_count,
    regular_season_weeks: settings.reg_season_count,
    playoff_team_count: settings.playoff_team_count,
    first_playoff_week: firstPlayoffWeek,
    playoff_matchup_length_weeks: settings.playoff_matchup_period_length || 1,
    playoff_seeding_tiebreaker: settings.playoff_seed_tie_rule,
    matchup_tie_rule: settings.tie_rule,
    median_scoring: Boolean(settings.median_scoring),
    median_scoring_note: settings.median_scoring
      ? 'Top-half win bonus is on: you can go 2-0 or 0-2 in a week, so raw scoring matters more than the head-to-head draw.'
      : null,
    keeper_count: settings.keeper_count,
    divisions: settings.division_map && Object.keys(settings.division_map).length ? settings.division_map : null,
    waivers: {
      uses_faab: Boolean(settings.faab),
      faab_budget: settings.faab ? settings.acquisition_budget : null,
      minimum_bid: settings.faab ? settings.minimum_bid : null,
      process_days: settings.waiver_process_days,
      process_hour: settings.waiver_process_hour,
      season_acquisition_limit: settings.acquisition_limit,
      weekly_acquisition_limit: settings.matchup_acquisition_limit ?? settings.matchup_limit_per_scoring_period
    },
    trades: {
      deadline_epoch_ms: settings.trade_deadline || null,
      deadline_iso: settings.trade_deadline ? new Date(settings.trade_deadline).toISOString() : null,
      veto_votes_required: settings.veto_votes_required,
      review_period_hours: settings.trade_revision_hours
    }
  };
}

function buildImplications(scoring, roster, rules) {
  const notes = [];

  if (roster.is_superflex) {
    notes.push(
      'SUPERFLEX: a QB can fill the OP slot, so quarterbacks are the scarcest asset. ' +
        'Rostering two startable QBs is close to mandatory, and QB trade value is far above standard leagues.'
    );
  }

  if (scoring.points_per_reception >= 1) {
    notes.push(
      'FULL PPR: pass-catching backs and high-volume slot receivers gain a lot. ' +
        'A 6-catch, 50-yard game beats a 15-carry, 60-yard game.'
    );
  } else if (scoring.points_per_reception === 0) {
    notes.push(
      'STANDARD scoring: receptions are worth nothing, so goal-line backs and touchdown-dependent ' +
        'players hold more relative value, and possession receivers lose value.'
    );
  } else if (scoring.points_per_reception > 0) {
    notes.push(`${scoring.format}: reception volume matters, but less than in full PPR.`);
  }

  if (scoring.passing_td_points != null && scoring.passing_td_points >= 6) {
    notes.push(
      `${scoring.passing_td_points}-point passing touchdowns (the common default is 4). ` +
        'Elite quarterbacks are worth notably more here than in a standard league.'
    );
  }

  if (scoring.interception_thrown_points != null && scoring.interception_thrown_points <= -3) {
    notes.push(
      `Interceptions cost ${scoring.interception_thrown_points} points, which is harsher than the ` +
        'usual -2. Favor low-turnover quarterbacks over high-volume gunslingers.'
    );
  }

  if (scoring.yardage_bonuses_active.length) {
    notes.push(
      `Yardage bonuses are active (${scoring.yardage_bonuses_active.join('; ')}). ` +
        'These reward boom players with high weekly ceilings over steady floor players.'
    );
  }

  if (roster.flex_slot_count >= 2) {
    notes.push(
      `${roster.flex_slot_count} FLEX slots means more startable players each week, so roster depth ` +
        'at RB/WR is worth more and bye weeks hurt more.'
    );
  }

  if (roster.ir_slots > 0) {
    notes.push(
      `${roster.ir_slots} IR slot(s): stashing an injured player is cheap. Only players ESPN marks ` +
        'OUT or INJURY_RESERVE are legal there, and an ineligible player in an IR slot blocks the lineup.'
    );
  } else if (roster.ir_slots === 0) {
    notes.push('No IR slots: every injured player you hold costs a real bench spot.');
  }

  if (rules.waivers.uses_faab) {
    notes.push(
      `FAAB waivers with a $${rules.waivers.faab_budget} season budget (min bid $${rules.waivers.minimum_bid}). ` +
        'Budget is a season-long resource: spend aggressively on genuine league-winners, $1-3 on lottery tickets.'
    );
  } else {
    notes.push('Rolling waiver priority, not FAAB: using your claim costs you position, so spend it deliberately.');
  }

  if (rules.median_scoring) notes.push(rules.median_scoring_note);
  if (rules.keeper_count > 0) {
    notes.push(`Keeper league (${rules.keeper_count} keepers): weigh future value, not just this season.`);
  }
  if (roster.has_idp) {
    notes.push('IDP league: individual defensive players start, so defensive tackle and sack volume matter.');
  }
  if (scoring.unmapped_stat_ids.length) {
    notes.push(
      `Heads up: ${scoring.unmapped_stat_ids.length} scoring rule(s) could not be labeled ` +
        `(stat IDs ${scoring.unmapped_stat_ids.join(', ')}). Treat scoring analysis as incomplete.`
    );
  }

  return notes;
}

export function buildLeagueProfile({ league, settings }) {
  const scoring = buildScoring(settings.scoring_format || []);
  const roster = buildRoster(settings.lineup_slots, settings.position_slot_counts);
  const rules = buildRules(settings);

  return {
    league: {
      name: settings.name ?? league?.name ?? null,
      league_id: league?.league_id ?? null,
      season: league?.year ?? null,
      current_week: league?.current_week ?? null
    },
    scoring,
    roster,
    rules,
    strategic_implications: buildImplications(scoring, roster, rules)
  };
}
