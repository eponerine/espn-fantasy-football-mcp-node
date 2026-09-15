import * as z from 'zod/v4';
import { jsonResult, leagueScope, READ_ONLY, safeHandler, weekParam } from './shared.js';

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST', 'FLEX'];

export function registerPlayerTools(server, client) {
  server.registerTool(
    'get_free_agents',
    {
      title: 'Free agents and waiver wire',
      description:
        'List unrostered players available on the waiver wire or as free agents, with ' +
        'projected points and recent points. This is the tool for "who should I pick up", ' +
        'streaming a defense or kicker, and finding a replacement for an injured starter. ' +
        'Filter by position and raise size to see deeper options.',
      inputSchema: z.object({
        ...leagueScope,
        week: weekParam,
        size: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe('How many players to return (default 50). Raise it when scanning a deep position.'),
        position: z
          .string()
          .optional()
          .describe(`Position filter, one of: ${POSITIONS.join(', ')}.`),
        positionId: z
          .number()
          .int()
          .optional()
          .describe('Raw ESPN position slot id, if you need a filter that `position` cannot express.')
      }),
      annotations: READ_ONLY
    },
    safeHandler(async (args) => jsonResult(await client.get('/free-agents', args)))
  );

  server.registerTool(
    'get_player_info',
    {
      title: 'Player card',
      description:
        'Look up a single player by name or ESPN playerId and get their position, pro team, ' +
        'ownership and start percentages, injury status, and scoring. Use the exact full name ' +
        '("Patrick Mahomes"); if the lookup fails, find the player via get_free_agents or ' +
        'get_roster and use the returned player_id instead.',
      inputSchema: z
        .object({
          ...leagueScope,
          playerId: z.number().int().positive().optional().describe('ESPN player id. Preferred when known.'),
          name: z.string().min(2).optional().describe('Full player name, e.g. "Patrick Mahomes".')
        })
        .refine((value) => value.playerId != null || value.name != null, {
          message: 'Provide either playerId or name.'
        }),
      annotations: READ_ONLY
    },
    safeHandler(async (args) => jsonResult(await client.get('/player-info', args)))
  );
}
