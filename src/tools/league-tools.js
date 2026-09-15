import * as z from 'zod/v4';
import { jsonResult, leagueScope, READ_ONLY, safeHandler, teamIdParam } from './shared.js';

export function registerLeagueTools(server, client) {
  server.registerTool(
    'get_health',
    {
      title: 'API health check',
      description:
        'Check that the ESPN fantasy football HTTP API this server talks to is reachable. ' +
        'Use this first when other tools fail, to tell "API is down" apart from "bad league config".',
      inputSchema: z.object({}),
      annotations: READ_ONLY
    },
    safeHandler(async () => jsonResult(await client.get('/health', {}, { useCache: false })))
  );

  server.registerTool(
    'get_league',
    {
      title: 'League summary',
      description:
        'Get the league id, season year, league name, team count and — most importantly — ' +
        'current_week. Call this before any week-scoped question so you know what "this week" means.',
      inputSchema: z.object({ ...leagueScope }),
      annotations: READ_ONLY
    },
    safeHandler(async (args) => jsonResult(await client.get('/league', args)))
  );

  server.registerTool(
    'get_settings',
    {
      title: 'League settings and scoring rules',
      description:
        'Get league settings: scoring format (PPR / half-PPR / standard and per-stat values), ' +
        'roster and lineup slot counts, playoff team count, playoff week matchup length, ' +
        'waiver/FAAB rules, keeper settings, and divisions. Player value depends entirely on ' +
        'these rules, so read them before ranking, trading or start/sit advice.',
      inputSchema: z.object({ ...leagueScope }),
      annotations: READ_ONLY
    },
    safeHandler(async (args) => jsonResult(await client.get('/settings', args)))
  );

  server.registerTool(
    'get_teams',
    {
      title: 'All fantasy teams',
      description:
        'List every fantasy team with team_id, name, abbreviation, record (wins/losses/ties), ' +
        'points for, points against and division. Use this to translate a team name the user ' +
        'typed into the numeric teamId other tools require.',
      inputSchema: z.object({ ...leagueScope }),
      annotations: READ_ONLY
    },
    safeHandler(async (args) => jsonResult(await client.get('/teams', args)))
  );

  server.registerTool(
    'get_standings',
    {
      title: 'League standings',
      description:
        'Get standings ordered by league rank with wins, losses, ties and points_for. ' +
        'Compare points_for against record to spot lucky and unlucky teams.',
      inputSchema: z.object({ ...leagueScope }),
      annotations: READ_ONLY
    },
    safeHandler(async (args) => jsonResult(await client.get('/standings', args)))
  );

  server.registerTool(
    'get_power_rankings',
    {
      title: 'Power rankings',
      description:
        'Get computed power rankings through a given week. Power score blends scoring and ' +
        'strength of opponents, so it is a better quality estimate than raw record. ' +
        'Use alongside get_standings to explain who is overperforming their record.',
      inputSchema: z.object({
        ...leagueScope,
        week: z
          .number()
          .int()
          .min(1)
          .max(18)
          .optional()
          .describe('Rank through this week. Omit for the current week.')
      }),
      annotations: READ_ONLY
    },
    safeHandler(async (args) => jsonResult(await client.get('/power-rankings', args)))
  );

  server.registerTool(
    'get_draft',
    {
      title: 'Draft results',
      description:
        'Get every draft pick with round, pick number, player, drafting team, auction bid ' +
        'amount and keeper status. Use for draft grades, steal/bust analysis, and to see ' +
        'how much a manager originally invested in a player being discussed in a trade.',
      inputSchema: z.object({ ...leagueScope }),
      annotations: READ_ONLY
    },
    safeHandler(async (args) => jsonResult(await client.get('/draft', args)))
  );

  server.registerTool(
    'get_roster',
    {
      title: 'Team roster for a week',
      description:
        'Get one team\'s roster for a specific week: player names, positions, lineup slot ' +
        '(starter vs bench), eligible slots, pro team, injury status and ownership percentages. ' +
        'This is the starting point for start/sit, trade and roster-construction questions. ' +
        'Both teamId and week are required.',
      inputSchema: z.object({
        ...leagueScope,
        teamId: teamIdParam,
        week: z
          .number()
          .int()
          .min(1)
          .max(18)
          .describe('Scoring week for the roster snapshot. Required.')
      }),
      annotations: READ_ONLY
    },
    safeHandler(async (args) => jsonResult(await client.get('/roster', args)))
  );
}
