import * as z from 'zod/v4';
import { buildLeagueProfile } from '../domain/league-profile.js';
import { analyzeLineup } from '../domain/lineup.js';
import { jsonResult, leagueScope, READ_ONLY, safeHandler, teamIdParam } from './shared.js';

export function registerAnalysisTools(server, client) {
  server.registerTool(
    'get_league_profile',
    {
      title: 'Interpreted league profile',
      description:
        'THE tool to call before giving any fantasy advice. Translates the league\'s raw ESPN ' +
        'settings into plain English: scoring format (PPR value, passing TD value, active yardage ' +
        'bonuses, every scoring rule grouped by category), the exact starting lineup including how ' +
        'many FLEX slots and whether it is superflex, bench and IR slot counts, roster size, waiver ' +
        'and FAAB mechanics, trade deadline, playoff structure, and a list of strategic implications ' +
        'those rules create. Player value depends entirely on these rules, so call this first rather ' +
        'than assuming a standard league.',
      inputSchema: z.object({ ...leagueScope }),
      annotations: READ_ONLY
    },
    safeHandler(async (args) => {
      const [{ settings }, league] = await Promise.all([
        client.get('/settings', args),
        client.get('/league', args)
      ]);
      return jsonResult(buildLeagueProfile({ league, settings }));
    })
  );

  server.registerTool(
    'check_lineup',
    {
      title: 'Lineup legality and optimization check',
      description:
        'Audit a team\'s lineup for a week against the league\'s real slot requirements and player ' +
        'availability. Detects: unfilled starting slots that would score zero, starters on a bye, ' +
        'starters who are OUT or DOUBTFUL, questionable starters needing a kickoff check, players ' +
        'illegally occupying an IR slot (which blocks lineup submission in ESPN), injured bench ' +
        'players who could be stashed on an open IR slot to free a bench spot, and bench players ' +
        'outscoring a starter they are eligible to replace. Use this for "is my lineup set", ' +
        '"am I missing anything", and IR or bench optimization questions.',
      inputSchema: z.object({
        ...leagueScope,
        teamId: teamIdParam,
        week: z
          .number()
          .int()
          .min(1)
          .max(18)
          .describe('Week to audit. Required, because rosters and byes are week-specific.')
      }),
      annotations: READ_ONLY
    },
    safeHandler(async (args) => {
      const { leagueId, year, teamId, week } = args;
      const scope = { leagueId, year };
      const [{ settings }, rosterResponse] = await Promise.all([
        client.get('/settings', scope),
        client.get('/roster', { ...scope, teamId, week })
      ]);

      const analysis = analyzeLineup({
        roster: rosterResponse.roster,
        lineupSlots: settings.lineup_slots,
        week
      });

      return jsonResult({
        team_id: rosterResponse.team_id,
        team_name: rosterResponse.team_name,
        ...analysis
      });
    })
  );
}
