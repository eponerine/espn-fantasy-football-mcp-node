import * as z from 'zod/v4';
import { RECAP_SECTIONS, SCHEMA_VERSION } from './payload.js';

const nullableNumber = z.number().nullable().optional();
const nullableString = z.string().nullable().optional();
const lineupPlayer = z.object({
  slot: nullableString, player_id: z.number(), name: z.string(), position: z.string(),
  points: nullableNumber, projected_points: nullableNumber,
  percent_rostered: z.number().min(0).max(100).optional()
});
const legacyObject = z.looseObject({});
const legacyArray = z.array(legacyObject);

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
  bench_analysis: legacyObject.optional(),
  team_lineups: z.array(z.object({
    team_id: z.number(), starters: z.array(lineupPlayer), bench: z.array(lineupPlayer), ir: z.array(lineupPlayer)
  })).describe('Actual recap-week slots and weekly points/projections, never optimal assignments.').optional(),
  roster_moves: z.looseObject({
    teams: legacyArray,
    bidding_wars: z.array(z.looseObject({
      total_bids: z.number().describe('Deprecated dollar-sum alias for total_bid_amount, NOT bid count.'),
      total_bid_amount: z.number(), bid_count: z.number().int(), bids: legacyArray
    }))
  }).describe('Claims carry acquired_order (1-based per player, chronological) and acquired_at. Points come only from that team\'s box score. Failed bids retain reason and add outcome: outbid, tiebreak_lost, player_already_dropped, invalid_source, roster_limit, or unknown.').optional(),
  pending_claims: z.array(z.looseObject({
    team_id: z.number(), type: z.enum(['WAIVER', 'FREEAGENT']),
    status: z.enum(['PENDING', 'CANCELED', 'CANCELLED']), scoring_period: z.number().int()
  })).describe('Next-week claims only; raw transaction fields retained.').optional(),
  injuries_and_byes: z.looseObject({
    slot_week: z.number().int(), week_points_week: z.number().int(), bye_teams: z.array(z.string()), teams: legacyArray
  }).describe('slot and next_week_slot refer to slot_week; week_points refers to week_points_week. Sentinel pro_team None is excluded.').optional(),
  injury_watch: z.array(z.object({
    team_id: z.number(), player_id: z.number(), name: z.string(), position: z.string(),
    injury_status: nullableString, next_week_slot: nullableString, week_points: nullableNumber,
    percent_rostered: nullableNumber, season_points_rank: nullableNumber,
    matched_criteria: z.array(z.enum(['season_points_rank', 'percent_rostered', 'next_week_starter'])).min(1)
  })).describe('Injured rostered players matching rank <=150, ownership >=60%, or a next-week starting slot. Season rank uses the existing rostered-player season-points ranking, not position rank. Status is current at report time.').optional(),
  power_rankings: legacyArray.optional(),
  prior_power_rankings: legacyArray.optional(),
  preview: legacyArray.describe('teams[].availability contains only team_id; join injuries_and_byes.teams on team_id.').optional(),
  validation: legacyObject.optional()
});

export function getRecapSchema() {
  return {
    ...z.toJSONSchema(recapSchema),
    description: 'Recap 1.1.0. Default returns all sections; sections selects top-level sections and always retains schema_version/meta. compact removes null-valued object fields recursively, retaining arrays, zero, false and all calculations. Legacy section objects allow additional fields.',
    'x-sections': RECAP_SECTIONS
  };
}