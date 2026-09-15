import * as z from 'zod/v4';
import { ApiError } from '../api-client.js';

/**
 * League scope is optional on every tool: omit it to use LEAGUE_ID/SEASON_YEAR
 * from the environment. ESPN cookies are deliberately NOT tool inputs — they stay
 * in server configuration so they never pass through a model's context.
 */
export const leagueScope = {
  leagueId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('ESPN league ID. Omit to use the server-configured default league.'),
  year: z
    .number()
    .int()
    .min(1990)
    .max(2100)
    .optional()
    .describe('Season year, e.g. 2026. Omit to use the server-configured default season.')
};

export const weekParam = z
  .number()
  .int()
  .min(1)
  .max(18)
  .optional()
  .describe(
    'NFL scoring week (1-18). Omit for the current week. Fantasy playoffs are usually weeks 15-17.'
  );

export const teamIdParam = z
  .number()
  .int()
  .positive()
  .describe('Fantasy team ID from get_teams. Resolve team names to IDs with get_teams first.');

export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

export function jsonResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function errorResult(error) {
  const message =
    error instanceof ApiError
      ? error.message
      : `Unexpected error: ${error?.message ?? String(error)}`;
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Wraps a handler so upstream failures come back as readable tool errors. */
export function safeHandler(handler) {
  return async (args, extra) => {
    try {
      return await handler(args, extra);
    } catch (error) {
      return errorResult(error);
    }
  };
}
