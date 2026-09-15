import * as z from 'zod/v4';
import { jsonResult, leagueScope, READ_ONLY, safeHandler, weekParam } from './shared.js';

export function registerMatchupTools(server, client) {
  server.registerTool(
    'get_scoreboard',
    {
      title: 'Weekly scoreboard',
      description:
        'Get head-to-head scores for a week: home/away team names, scores and whether the ' +
        'matchup is a playoff game. Safe to call for future weeks, where scores will be zero. ' +
        'For per-player detail use get_box_scores instead.',
      inputSchema: z.object({ ...leagueScope, week: weekParam }),
      annotations: READ_ONLY
    },
    safeHandler(async (args) => jsonResult(await client.get('/scoreboard', args)))
  );

  server.registerTool(
    'get_matchups',
    {
      title: 'Weekly matchups',
      description:
        'Get the matchup schedule for a week, including matchup_type (regular season, ' +
        'winners bracket, losers/consolation bracket). Use this to preview who plays whom, ' +
        'including future weeks, and to work out playoff scenarios.',
      inputSchema: z.object({ ...leagueScope, week: weekParam }),
      annotations: READ_ONLY
    },
    safeHandler(async (args) => jsonResult(await client.get('/matchups', args)))
  );

  server.registerTool(
    'get_box_scores',
    {
      title: 'Box scores with lineups',
      description:
        'Get detailed box scores for a week: actual and projected team scores plus, with ' +
        'includeLineup, every starter and bench player with their points, projected points, ' +
        'slot, pro opponent, bye-week flag and injury status. This is the richest tool here — ' +
        'use it for start/sit review, bench blunders, over/under-performance versus projection ' +
        'and weekly recaps. Requesting a week later than the league current_week fails with an ' +
        'error, so check get_league first.',
      inputSchema: z.object({
        ...leagueScope,
        week: weekParam,
        includeLineup: z
          .boolean()
          .optional()
          .describe('Include full per-player home and away lineups. Set true for any player-level analysis.')
      }),
      annotations: READ_ONLY
    },
    safeHandler(async (args) => jsonResult(await client.get('/box-scores', args)))
  );
}
