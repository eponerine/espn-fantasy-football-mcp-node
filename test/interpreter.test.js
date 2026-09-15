import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLeagueProfile } from '../src/domain/league-profile.js';
import { analyzeLineup } from '../src/domain/lineup.js';

const LINEUP_SLOTS = [
  { slot_id: 0, slot: 'QB', eligible_positions: ['QB'], type: 'START', count: 1 },
  { slot_id: 2, slot: 'RB', eligible_positions: ['RB'], type: 'START', count: 2 },
  { slot_id: 4, slot: 'WR', eligible_positions: ['WR'], type: 'START', count: 2 },
  { slot_id: 6, slot: 'TE', eligible_positions: ['TE'], type: 'START', count: 1 },
  { slot_id: 23, slot: 'RB/WR/TE', eligible_positions: ['RB', 'WR', 'TE'], type: 'FLEX', count: 2 },
  { slot_id: 16, slot: 'D/ST', eligible_positions: ['D/ST'], type: 'START', count: 1 },
  { slot_id: 17, slot: 'K', eligible_positions: ['K'], type: 'START', count: 1 },
  { slot_id: 20, slot: 'BE', eligible_positions: [], type: 'BENCH', count: 6 },
  { slot_id: 21, slot: 'IR', eligible_positions: [], type: 'IR', count: 1 }
];

function makeSettings(overrides = {}) {
  return {
    name: 'Test League',
    reg_season_count: 14,
    playoff_team_count: 6,
    playoff_matchup_period_length: 1,
    team_count: 12,
    keeper_count: 0,
    faab: true,
    acquisition_budget: 100,
    minimum_bid: 1,
    waiver_process_days: ['WEDNESDAY'],
    waiver_process_hour: 3,
    trade_deadline: 0,
    division_map: {},
    median_scoring: false,
    lineup_slots: LINEUP_SLOTS,
    scoring_format: [
      { id: 3, abbr: 'PY', label: 'Passing Yards', points: 0.04 },
      { id: 4, abbr: 'PTD', label: 'TD Pass', points: 6 },
      { id: 20, abbr: 'INTT', label: 'Interceptions Thrown', points: -2 },
      { id: 24, abbr: 'RY', label: 'Rushing Yards', points: 0.1 },
      { id: 25, abbr: 'RTD', label: 'TD Rush', points: 6 },
      { id: 41, abbr: 'RECS', label: 'Receptions', points: 0.5 },
      { id: 43, abbr: 'RETD', label: 'TD Reception', points: 6 },
      { id: 72, abbr: 'FUML', label: 'Total Fumbles Lost', points: -2 }
    ],
    ...overrides
  };
}

const LEAGUE = { league_id: 42, year: 2026, current_week: 3, name: 'Test League' };

test('profile detects half-PPR, multi-FLEX and IR slots', () => {
  const profile = buildLeagueProfile({ league: LEAGUE, settings: makeSettings() });

  assert.equal(profile.scoring.format, 'Half-PPR');
  assert.equal(profile.scoring.passing_td_points, 6);
  assert.equal(profile.roster.flex_slot_count, 2);
  assert.equal(profile.roster.ir_slots, 1);
  assert.equal(profile.roster.bench_slots, 6);
  assert.equal(profile.roster.starting_slot_count, 10);
  assert.equal(profile.roster.total_roster_size, 17);
  assert.equal(profile.roster.is_superflex, false);
});

test('profile flags superflex and surfaces it as an implication', () => {
  const settings = makeSettings({
    lineup_slots: [
      ...LINEUP_SLOTS,
      { slot_id: 7, slot: 'OP', eligible_positions: ['QB', 'RB', 'WR', 'TE'], type: 'FLEX', count: 1 }
    ]
  });
  const profile = buildLeagueProfile({ league: LEAGUE, settings });

  assert.equal(profile.roster.is_superflex, true);
  assert.ok(profile.strategic_implications.some((note) => note.includes('SUPERFLEX')));
});

test('profile calls out 6-point passing TDs and reports unmapped scoring', () => {
  const settings = makeSettings({
    scoring_format: [
      ...makeSettings().scoring_format,
      { id: 999, abbr: 'Unknown', label: 'Unknown (statId 999)', points: 3 }
    ]
  });
  const profile = buildLeagueProfile({ league: LEAGUE, settings });

  assert.deepEqual(profile.scoring.unmapped_stat_ids, [999]);
  assert.ok(profile.strategic_implications.some((note) => note.includes('6-point passing touchdowns')));
  assert.ok(profile.strategic_implications.some((note) => note.includes('could not be labeled')));
});

test('profile degrades gracefully without lineup_slots', () => {
  const settings = makeSettings({ lineup_slots: undefined, position_slot_counts: { QB: 1 } });
  const profile = buildLeagueProfile({ league: LEAGUE, settings });
  assert.match(profile.roster.warning, /does not expose lineup_slots/);
});

function starter(name, slot, extra = {}) {
  return {
    name,
    position: slot === 'RB/WR/TE' ? 'RB' : slot,
    pro_team: 'KC',
    lineup_slot: slot,
    eligible_slots: [slot, 'BE'],
    injury_status: 'ACTIVE',
    on_bye_week: false,
    projected_avg_points: 12,
    ...extra
  };
}

test('detects bye-week starters, OUT starters and empty slots', () => {
  const roster = [
    starter('QB1', 'QB', { on_bye_week: true }),
    starter('RB1', 'RB'),
    starter('RB2', 'RB', { injury_status: 'OUT' }),
    starter('WR1', 'WR'),
    starter('WR2', 'WR'),
    starter('TE1', 'TE'),
    starter('FLEX1', 'RB/WR/TE'),
    starter('DST', 'D/ST'),
    starter('K1', 'K')
  ];

  const result = analyzeLineup({ roster, lineupSlots: LINEUP_SLOTS, week: 3 });

  assert.equal(result.lineup_is_legal, false);
  assert.ok(result.issues.some((i) => i.type === 'bye_week_starter' && i.player === 'QB1'));
  assert.ok(result.issues.some((i) => i.type === 'unstartable_starter' && i.player === 'RB2'));
  // Only one of two FLEX slots is filled.
  assert.ok(result.issues.some((i) => i.type === 'empty_slot' && i.slot === 'RB/WR/TE'));
});

test('flags a healthy player illegally occupying IR', () => {
  const roster = [starter('Healthy Guy', 'IR', { injury_status: 'ACTIVE' })];
  const result = analyzeLineup({ roster, lineupSlots: LINEUP_SLOTS, week: 3 });

  const issue = result.issues.find((i) => i.type === 'illegal_ir');
  assert.ok(issue);
  assert.equal(result.lineup_is_legal, false);
  assert.match(issue.message, /blocks lineup submission/);
});

test('suggests an IR stash when a slot is open', () => {
  const roster = [starter('Hurt Guy', 'BE', { injury_status: 'OUT' })];
  const result = analyzeLineup({ roster, lineupSlots: LINEUP_SLOTS, week: 3 });

  assert.ok(result.issues.some((i) => i.type === 'ir_stash_available' && i.player === 'Hurt Guy'));
});

test('finds a bench player outscoring a starter it may legally replace', () => {
  const roster = [
    starter('Weak RB', 'RB', { projected_avg_points: 5 }),
    {
      ...starter('Strong Bench', 'BE', { projected_avg_points: 18 }),
      eligible_slots: ['RB', 'RB/WR/TE', 'BE']
    }
  ];

  const result = analyzeLineup({ roster, lineupSlots: LINEUP_SLOTS, week: 3 });
  const upgrade = result.issues.find((i) => i.type === 'bench_upgrade');

  assert.ok(upgrade);
  assert.equal(upgrade.player, 'Strong Bench');
  assert.equal(upgrade.replaces, 'Weak RB');
});

test('does not suggest a bench player who cannot fill the slot', () => {
  const roster = [
    starter('Weak QB', 'QB', { projected_avg_points: 5 }),
    { ...starter('Strong WR', 'BE', { projected_avg_points: 20 }), eligible_slots: ['WR', 'BE'] }
  ];

  const result = analyzeLineup({ roster, lineupSlots: LINEUP_SLOTS, week: 3 });
  assert.equal(result.issues.filter((i) => i.type === 'bench_upgrade').length, 0);
});

test('treats an all-bye roster as missing schedule data, not twelve byes', () => {
  const roster = [
    starter('QB1', 'QB', { on_bye_week: true }),
    starter('RB1', 'RB', { on_bye_week: true })
  ];

  const result = analyzeLineup({ roster, lineupSlots: LINEUP_SLOTS, week: 3 });

  assert.ok(result.issues.some((i) => i.type === 'bye_data_unreliable'));
  assert.equal(result.issues.filter((i) => i.type === 'bye_week_starter').length, 0);
});

test('reports unanalyzable when lineup slots are missing', () => {
  const result = analyzeLineup({ roster: [], lineupSlots: undefined, week: 3 });
  assert.equal(result.analyzed, false);
});
