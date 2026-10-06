import { McpServer } from '@modelcontextprotocol/server';
import { registerPrompts } from './prompts/index.js';
import { registerResources } from './resources/index.js';
import { registerAllTools } from './tools/index.js';

const SERVER_INSTRUCTIONS = `This server answers questions about an ESPN fantasy football league by
calling an HTTP API wrapper around ESPN's fantasy endpoints.

Start with get_league_profile. It returns the current week plus the league's rules translated into
plain English: scoring format, the exact starting lineup (how many FLEX slots, superflex or not),
bench and IR counts, waiver/FAAB mechanics and playoff structure. Player value depends entirely on
those rules, so never assume a standard league.

Resolve team names to numeric ids with get_teams before calling get_roster or check_lineup. For
anything lineup-related, call check_lineup: it validates slots, byes, injuries and IR legality
against the league's real settings.

Two data traps worth remembering: a roster player's projected_points and total_points are SEASON
figures, not weekly (use get_box_scores with includeLineup=true for weekly projections); and
active_status reads as 'bye' for everyone before kickoff, so use on_bye_week and injury_status for
availability instead.

If you are unsure which tools a question needs, call how_to_answer; if the fantasy jargon is
unfamiliar, call explain_fantasy_football.

All tools are read-only. Data is limited to this league plus ESPN's own projections; it contains
no injury news, weather or outside expert rankings, so do not invent them.`;

export function createServer({ client, injuryReportCache = new Map() }) {
  const server = new McpServer(
    { name: 'espn-fantasy-football', version: '0.1.0' },
    { instructions: SERVER_INSTRUCTIONS }
  );
  registerAllTools(server, client, { injuryReportCache });
  registerResources(server, client);
  registerPrompts(server);
  return server;
}