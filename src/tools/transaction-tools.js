import * as z from 'zod/v4';
import { jsonResult, leagueScope, READ_ONLY, safeHandler } from './shared.js';

export function registerTransactionTools(server, client) {
  server.registerTool(
    'get_transactions',
    {
      title: 'Transactions for a scoring period',
      description:
        'Get roster transactions (waiver claims, free-agent adds, drops, trades) for a scoring ' +
        'period, including FAAB bid amounts and whether a claim succeeded or failed. Use this to ' +
        'see what the waiver market paid for a player and which managers are chasing the same needs.',
      inputSchema: z.object({
        ...leagueScope,
        scoringPeriod: z
          .number()
          .int()
          .min(1)
          .max(18)
          .optional()
          .describe('Scoring period (week) to filter on. Omit for the current period.'),
        types: z
          .string()
          .optional()
          .describe(
            'Comma-separated transaction types, e.g. "FREEAGENT,WAIVER,WAIVER_ERROR,TRADE_ACCEPT,ROSTER".'
          )
      }),
      annotations: READ_ONLY
    },
    safeHandler(async (args) => jsonResult(await client.get('/transactions', args)))
  );

  server.registerTool(
    'get_activity',
    {
      title: 'Recent league activity feed',
      description:
        'Get the league activity feed — the chronological "who added/dropped/traded what" log. ' +
        'Best tool for "what did I miss this week" and for newsletter or recap writing. ' +
        'Page through with size and offset.',
      inputSchema: z.object({
        ...leagueScope,
        size: z.number().int().min(1).max(200).optional().describe('Number of activity entries (default 25).'),
        offset: z.number().int().min(0).optional().describe('Entries to skip, for paging (default 0).'),
        msgType: z
          .string()
          .optional()
          .describe('Filter by message type, e.g. "WAIVER", "FA", or "TRADED".')
      }),
      annotations: READ_ONLY
    },
    safeHandler(async (args) => jsonResult(await client.get('/activity', args)))
  );
}
