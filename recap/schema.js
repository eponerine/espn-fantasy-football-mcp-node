import * as z from 'zod/v4';
import { RECAP_SECTIONS, SCHEMA_VERSION } from './payload.js';

const nullableNumber = z.number().nullable().optional();
const nullableString = z.string().nullable().optional();
const lineupPlayer = z.object({
  slot: nullableString, player_id: z.number(), name: z.string(), position: z.string(),
  points: nullableNumber, projected_points: nullableNumber,
  pro_team: nullableString, injury_status: nullableString.describe('Status as of the parent entry injury_status_as_of for status_week (recap week + 1). Vocabulary: ACTIVE, QUESTIONABLE, DOUBTFUL, OUT, INJURY_RESERVE, ...; ESPN NORMAL (healthy D/ST) is normalized to ACTIVE.'),
  is_bye_next_week: z.boolean(), percent_rostered: z.number().min(0).max(100).nullable().optional()
});
const legacyObject = z.looseObject({});
const legacyArray = z.array(legacyObject);
const timestamp = z.iso.datetime();
const powerRankings = z.array(z.looseObject({
  diff_vs_espn: nullableNumber.describe('espn_rank - rank; positive means the custom ranking places this team higher than ESPN.')
}));

export const recapSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  meta: z.looseObject({
    league_id: nullableNumber, season: nullableNumber,
    week: z.number().int().positive(), generated_at: z.string(), regular_season: z.boolean()
  }),
  teams: z.array(z.looseObject({ team_id: z.number(), display_name: nullableString })).optional(),
  week_summary: legacyObject.optional(),
  scoreboard: legacyArray.describe('home_rank and away_rank reference standings rank; null outside regular season.').optional(),
  standings: legacyArray.optional(),
  season_summary: legacyObject.optional(),
  players: legacyObject.optional(),
  bench_analysis: z.looseObject({
    what_ifs: z.array(z.union([legacyObject, z.number()])).optional().describe('Duplicates teams[].what_ifs for teams whose result changes; team_id[] in slim mode.'),
    teams: z.array(z.looseObject({
      optimal_assignment: legacyArray.optional().describe('Globally compatible optimal lineup; omitted when include_optimal_assignment is false.'),
      assignment: legacyArray.optional().describe('Deprecated alias of optimal_assignment; omitted with include_optimal_assignment=false.'),
      swaps: legacyArray.describe('Independent single-swap alternatives, not a simultaneous plan. Gains must not be added together.')
    }))
  }).optional(),
  team_lineups_week: z.number().int().describe('Recap scoring week for team_lineups; retained whenever that section is selected.').optional(),
  team_lineups: z.array(z.object({
    team_id: z.number(), roster_week: z.number().int().describe('Recap week N: slots, points and projections.'),
    status_week: z.number().int().nullable().optional().describe('Week N+1: injury_status and is_bye_next_week refer to this week. Absent only in pre-1.3 captures.'),
    injury_status_as_of: timestamp.nullable().optional(), starters_total: z.number(), bench_total: z.number(),
    starters: z.array(lineupPlayer), bench: z.array(lineupPlayer), ir: z.array(lineupPlayer)
  })).describe('Actual recap-week slots and weekly points/projections (week N), never optimal assignments. injury_status and is_bye_next_week are current at injury_status_as_of for status_week (N+1). Player pro_team, projected_points and percent_rostered are always present (null when unavailable), including in compact output.').optional(),
  roster_moves: z.looseObject({
    teams: legacyArray,
    bidding_wars: z.array(z.looseObject({
      total_bids: z.number().describe('Deprecated dollar-sum alias for total_bid_amount, NOT bid count.'),
      total_bid_amount: z.number(), bid_count: z.number().int(), bids: legacyArray
    }))
  }).describe('faab_bid = faab_spent + faab_lost (processed EXECUTED and FAILED_* bids only). ESPN keeps a PENDING/CANCELED pre-processing copy of each claim; every FAILED_* status outranks it in deduplication. Bids with no processed row (CANCELED, PENDING, ...) are listed in unprocessed_bids and summed in faab_unprocessed, never in faab_bid. Claims carry acquired_order (1-based per player, chronological) and acquired_at. Points come only from that team\'s box score. Failed bids retain reason, dropped_player (the claim\'s own DROP item) and winner (deprecated name) and include winner_team_id and winning_bid (null without a same-window winner). Outcomes: outbid or tiebreak_lost for a same-player same-processing-second winner; for FAILED_PLAYERALREADYDROPPED without a winner, drop_player_already_dropped when the claim\'s DROP player had already left the roster through an earlier executed move by the same team, else player_already_dropped; otherwise unknown. top_spender.team_id identifies the teams[] entry.').optional(),
  pending_claims: z.array(z.looseObject({
    team_id: z.number(), type: z.enum(['WAIVER', 'FREEAGENT']),
    status: z.enum(['PENDING', 'CANCELED', 'CANCELLED']), scoring_period: z.number().int()
  })).describe('Next-week claims only; raw transaction fields retained.').optional(),
  pending_claims_meta: z.object({
    scoring_period: z.number().int(),
    transaction_types_checked: z.array(z.string()).describe('Types present in the fetched source (upstream default WAIVER, FREEAGENT, WAIVER_ERROR).'),
    pending_types: z.array(z.string()).optional(), pending_statuses: z.array(z.string()).optional(),
    source_count: z.number().int().nonnegative().nullable().describe('Raw fetched transactions before filtering. Null only for legacy captures without retained source data.'),
    source_status_counts: z.record(z.string(), z.number().int()).optional().describe('Raw source rows by "TYPE:STATUS".')
  }).describe('Pending-claim source coverage, retained alongside pending_claims even when there are no claims. ESPN only exposes other teams\' pending waiver claims after processing, so an empty list is normal before waivers run. Live fetch failures fail the tool; they are never represented as a successful empty result.').optional(),
  injuries_and_byes: z.looseObject({
    injuries_as_of: timestamp, roster_week: z.number().int().nullable(),
    metadata: z.looseObject({
      slot_alias: z.literal('next_week_slot'),
      canonical_slot_field: z.literal('next_week_slot').optional().describe('slot is a deprecated duplicate; slim mode drops it.'),
      slot_semantics: z.string().describe('slot and next_week_slot are roster snapshot assignments, not final next-week lineups.')
    }),
    slot_week: z.number().int().optional().describe('Legacy roster_week alias.'),
    week_points_week: z.number().int().optional(), bye_teams: z.array(z.string()), teams: legacyArray
  }).describe('Current injury snapshot at injuries_as_of, using roster_week assignments. slot is an alias of next_week_slot, not a final next-week lineup. week_points refers to the recap week. Default gaps are actionable only; include_gap_detail includes every starting slot. Sentinel pro_team None is excluded.').optional(),
  injury_watch: z.array(z.object({
    team_id: z.number(), player_id: z.number(), name: z.string(), position: z.string(),
    injuries_as_of: timestamp, roster_week: z.number().int().nullable(),
    injury_status: nullableString, next_week_slot: nullableString, week_points: nullableNumber,
    percent_rostered: nullableNumber, season_points_rank: nullableNumber,
    matched_criteria: z.array(z.enum(['season_points_rank', 'percent_rostered', 'next_week_starter'])).min(1)
  })).describe('Injured rostered players matching rank <=150, ownership >=60%, or a next-week starting slot. Season rank uses the existing rostered-player season-points ranking, not position rank. Status is current at report time.').optional(),
  power_rankings: powerRankings.optional(),
  prior_power_rankings: powerRankings.optional(),
  preview: legacyArray.describe('teams[].availability contains only team_id; join injuries_and_byes.teams on team_id. teams[].next_week_flags contains player-name arrays and open_ir_slots, the count of available IR slots. Flags describe the roster snapshot, not final next-week lineups.').optional(),
  validation: legacyObject.optional()
});

export function getRecapSchema() {
  return {
    ...z.toJSONSchema(recapSchema),
    description: `Recap ${SCHEMA_VERSION}. Default returns all sections; sections always retains schema_version/meta and retains team_lineups_week with team_lineups and pending_claims_meta with pending_claims. include_history=true retains history; include_gap_detail=false limits gaps to actionable rows; include_optimal_assignment=true retains optimal_assignment and its deprecated assignment alias. compact removes null-valued object fields recursively, except player pro_team, week_points, projected_points and percent_rostered (always explicit null), retaining arrays, zero, false and all calculations. slim (opt-in) replaces duplicated objects with references; see x-slim. Tool text is minified JSON unless pretty=true. week_summary season_high/previous_season_high/season_low carry both name and team. Legacy section objects allow additional fields.`,
    'x-sections': RECAP_SECTIONS,
    'x-slim': {
      'week_summary.closest_margin|biggest_margin_this_week': '{matchup_index (into scoreboard), home_team_id, away_team_id, margin}',
      'week_summary.largest_margin|previous_largest_margin': '{week, margin, home_team_id, away_team_id}',
      'season_summary.luckiest|unluckiest[]': '{team_id, luck_delta, expected_wins}; cut_line unchanged',
      'bench_analysis.what_ifs': 'team_id[]; full rows remain in bench_analysis.teams[].what_ifs',
      'roster_moves.top_spender': '{team_id}',
      'roster_moves.teams[].free_agent_adds|drops': 'player name strings',
      'prior_power_rankings[]': '{team_id, rank, all_play, points_for}',
      'preview[].teams[]': '{team_id, espn_power_score, next_week_flags}',
      'injuries_and_byes.teams[]': '{team_id, byes, ir_players, gaps (actionable only)}; injuries and flags dropped (see injury_watch and preview next_week_flags); slot alias dropped'
    }
  };
}