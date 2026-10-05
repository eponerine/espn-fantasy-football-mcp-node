import * as z from 'zod/v4';
import { buildLeagueProfile } from '../domain/league-profile.js';
import { analyzeLineup } from '../domain/lineup.js';
import { buildInjuryReport, isHealthy, rankTopPlayers } from '../domain/injury-report.js';
import { jsonResult, leagueScope, READ_ONLY, safeHandler, teamIdParam } from './shared.js';

const INJURY_REPORT_TTL_MS = 30 * 60 * 1000;
const PLAYER_CARD_CONCURRENCY = 4;

// Each upstream call rebuilds the league from ESPN, so cap how many run at once.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function registerAnalysisTools(server, client) {
  const injuryReportCache = new Map();

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

  server.registerTool(
    'get_injury_report',
    {
      title: 'Weekly injury report for top scorers',
      description:
        'Injury report for the season-to-date top N rostered players (default 100) in this league\'s ' +
        'scoring. Flags everyone whose CURRENT designation is not healthy (QUESTIONABLE, DOUBTFUL, OUT, ' +
        'INJURY_RESERVE, SUSPENSION, etc.), then reads each one\'s game log to classify whether the ' +
        'injury is new in the recap week (hurt in the game, missed the game) or an ongoing absence. ' +
        'Also groups the injuries by fantasy team with the positions each manager must now fill and ' +
        'their best healthy bench options. Results are cached per league/week for 30 minutes so the ' +
        'same snapshot can be reused across sections of a recap. It has no news feed: injury type and ' +
        'return timeline are not included.',
      inputSchema: z.object({
        ...leagueScope,
        week: z
          .number()
          .int()
          .min(1)
          .max(18)
          .describe('The week just played (the recap week). Used to judge whether an injury is new.'),
        topN: z
          .number()
          .int()
          .min(10)
          .max(300)
          .optional()
          .describe('How many top season scorers to check. Defaults to 100.'),
        refresh: z
          .boolean()
          .optional()
          .describe('Bypass the cached report and rebuild it. Leave unset when reusing within a recap.')
      }),
      annotations: READ_ONLY
    },
    safeHandler(async (args) => {
      const { leagueId, year, week, topN = 100, refresh = false } = args;
      const scope = { leagueId, year };
      const cacheKey = JSON.stringify({ ...client.defaults, ...scope, week, topN });

      const cached = injuryReportCache.get(cacheKey);
      if (!refresh && cached && cached.expiresAt > Date.now()) {
        return jsonResult({ ...cached.report, served_from_cache: true });
      }

      const [league, { teams }] = await Promise.all([client.get('/league', scope), client.get('/teams', scope)]);
      const currentWeek = league.current_week;

      const rosters = await mapWithConcurrency(teams, PLAYER_CARD_CONCURRENCY, (team) =>
        client.get('/roster', { ...scope, teamId: team.team_id, week: currentWeek })
      );

      const topPlayers = rankTopPlayers(rosters, topN);
      const injured = topPlayers.filter((p) => !isHealthy(p.injury_status));

      const cards = await mapWithConcurrency(injured, PLAYER_CARD_CONCURRENCY, async (player) => {
        try {
          const { player: card } = await client.get('/player-info', { ...scope, playerId: player.player_id });
          return [player.player_id, card];
        } catch {
          return [player.player_id, null];
        }
      });

      const report = buildInjuryReport({
        rosters,
        topPlayers,
        playerCards: new Map(cards),
        recapWeek: week,
        currentWeek,
        asOf: new Date().toISOString()
      });

      injuryReportCache.set(cacheKey, { report, expiresAt: Date.now() + INJURY_REPORT_TTL_MS });
      return jsonResult(report);
    })
  );
}
