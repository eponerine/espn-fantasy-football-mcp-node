import { mkdir, writeFile } from 'node:fs/promises';
import { FantasyApiClient } from '../src/api-client.js';
import { loadConfig } from '../src/config.js';
import { createRecapHandler } from '../src/tools/recap-tools.js';

const config = loadConfig();
const client = new FantasyApiClient(config);
const scope = { leagueId: 380348, year: 2026 };
const handler = createRecapHandler({
  get: (path, params) => client.get(path, { ...params, ...scope })
});
const recap = await handler({ week: 7, include_preview: true });
if (Number(recap.meta.league_id) !== scope.leagueId || Number(recap.meta.season) !== scope.year) {
  throw new Error('The upstream API returned a different league or season.');
}
function sanitize(value, teamId) {
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry, teamId));
  if (!value || typeof value !== 'object') return value;
  const id = value.team_id ?? teamId;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key, key === 'owner_name' ? `owner_${id}` : sanitize(entry, id)
  ]));
}
const destination = new URL('../tests/fixtures/recap_w7.json', import.meta.url);
await mkdir(new URL('.', destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(sanitize(recap), null, 2)}\n`);
console.log(`Saved sanitized Week 7 recap for league ${recap.meta.league_id}, season ${recap.meta.season}.`);