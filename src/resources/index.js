import { ESPN_CODES } from '../domain/espn-codes.js';
import { FULL_GLOSSARY } from '../domain/glossary.js';
import { buildLeagueProfile } from '../domain/league-profile.js';
import { PLAYBOOK_MARKDOWN } from '../domain/playbook.js';

export function registerResources(server, client) {
  server.registerResource(
    'fantasy-football-glossary',
    'fantasy://knowledge/glossary',
    {
      title: 'Fantasy football glossary',
      description: 'How fantasy football works: formats, scoring, lineup slots, waivers, strategy terms.',
      mimeType: 'text/markdown'
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: FULL_GLOSSARY }]
    })
  );

  server.registerResource(
    'question-playbook',
    'fantasy://knowledge/playbook',
    {
      title: 'Question playbook',
      description: 'Which tools to combine for the questions fantasy managers actually ask.',
      mimeType: 'text/markdown'
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: PLAYBOOK_MARKDOWN }]
    })
  );

  server.registerResource(
    'api-openapi-spec',
    'fantasy://api/openapi.json',
    {
      title: 'Upstream API OpenAPI spec',
      description: 'The live OpenAPI document served by the ESPN fantasy football HTTP API.',
      mimeType: 'application/json'
    },
    async (uri) => {
      const spec = await client.get('/openapi.json');
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(spec, null, 2) }]
      };
    }
  );

  server.registerResource(
    'league-snapshot',
    'fantasy://league/current',
    {
      title: 'Configured league snapshot',
      description: 'Summary of the league this server is configured against, including current week.',
      mimeType: 'application/json'
    },
    async (uri) => {
      const league = await client.get('/league');
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(league, null, 2) }]
      };
    }
  );

  server.registerResource(
    'espn-code-reference',
    'fantasy://knowledge/espn-codes',
    {
      title: 'ESPN code reference',
      description: 'Decoder for ESPN lineup slot IDs, stat IDs, injury statuses and transaction types.',
      mimeType: 'text/markdown'
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: ESPN_CODES }]
    })
  );

  server.registerResource(
    'league-rules-digest',
    'fantasy://league/rules-digest',
    {
      title: 'Interpreted league rules digest',
      description: 'Plain-English scoring, lineup, waiver and playoff rules for the configured league.',
      mimeType: 'application/json'
    },
    async (uri) => {
      const [{ settings }, league] = await Promise.all([client.get('/settings'), client.get('/league')]);
      const profile = buildLeagueProfile({ league, settings });
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(profile, null, 2) }]
      };
    }
  );
}
