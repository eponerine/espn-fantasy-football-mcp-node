import * as z from 'zod/v4';
import { RECAP_SECTIONS, SCHEMA_VERSION } from './payload.js';

const nullableNumber = z.number().nullable().optional();
const nullableString = z.string().nullable().optional();
const lineupPlayer = z.object({
  slot: nullableString, player_id: z.number(), name: z.string(), position: z.string(),
  points: nullableNumber, projected_points: nullableNumber,
  pro_team: nullableString, injury_status: nullableString,
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
    teams: z.array(z.looseObject({
      optimal_assignment: legacyArray.optional().describe('Globally compatible optimal lineup; omitted when include_optimal_assignment is false.'),
      assignment: legacyArray.optional().describe('Deprecated alias of optimal_assignment; omitted with include_optimal_assignment=false.'),
      swaps: legacyArray.describe('Independent single-swap alternatives, not a simultaneous plan. Gains must not be added together.')
    }))
  }).optional(),
  team_lineups_week: z.number().int().describe('Recap scoring week for team_lineups; retained whenever that section is selected.').optional(),
  team_lineups: z.array(z.object({
    team_id: z.number(), roster_week: z.number().int(), starters_total: z.number(), bench_total: z.number(),
    starters: z.array(lineupPlayer), bench: z.array(lineupPlayer), ir: z.array(lineupPlayer)
  })).describe('Actual recap-week slots and weekly points/projections, never optimal assignments. Player pro_team, injury_status, is_bye_next_week and percent_rostered are required in noncompact output; unavailable values are null.').optional(),
  roster_moves: z.looseObject({
    teams: legacyArray,
    bidding_wars: z.array(z.looseObject({
      total_bids: z.number().describe('Deprecated dollar-sum alias for total_bid_amount, NOT bid count.'),
      total_bid_amount: z.number(), bid_count: z.number().int(), bids: legacyArray
    }))
  }).describe('Claims carry acquired_order (1-based per player, chronological) and acquired_at. Points come only from that team\'s box score. Failed bids retain reason and winner (deprecated name) and include winner_team_id and winning_bid (null without a same-window winner). Outcomes are outbid or tiebreak_lost for a same-player same-processing-second winner; otherwise player_already_dropped only for FAILED_PLAYERALREADYDROPPED, or unknown.').optional(),
  pending_claims: z.array(z.looseObject({
    team_id: z.number(), type: z.enum(['WAIVER', 'FREEAGENT']),
    status: z.enum(['PENDING', 'CANCELED', 'CANCELLED']), scoring_period: z.number().int()
  })).describe('Next-week claims only; raw transaction fields retained.').optional(),
  pending_claims_meta: z.object({
    scoring_period: z.number().int(), transaction_types_checked: z.array(z.string()),
    source_count: z.number().int().nonnegative().nullable().describe('Raw fetched transactions before filtering. Null only for legacy captures without retained source data.')
  }).describe('Pending-claim source coverage, retained alongside pending_claims even when there are no claims. Live fetch failures fail the tool; they are never represented as a successful empty result.').optional(),
  injuries_and_byes: z.looseObject({
    injuries_as_of: timestamp, roster_week: z.number().int().nullable(),
    metadata: z.looseObject({
      slot_alias: z.literal('next_week_slot'),
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
    description: 'Recap 1.2.0. Default returns all sections; sections always retains schema_version/meta and retains team_lineups_week with team_lineups and pending_claims_meta with pending_claims. include_history=true retains history; include_gap_detail=false limits gaps to actionable rows; include_optimal_assignment=true retains optimal_assignment and its deprecated assignment alias. compact removes null-valued object fields recursively, including required nullable fields from the noncompact schema, retaining arrays, zero, false and all calculations. Legacy section objects allow additional fields.',
    'x-sections': RECAP_SECTIONS
  };
}