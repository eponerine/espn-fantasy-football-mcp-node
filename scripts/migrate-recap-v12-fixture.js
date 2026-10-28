import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectRecapSections } from '../recap/payload.js';
import { COMPACT_REQUESTED_OPTIONS, readOriginalFixture, migrateFixture, legacyCompact, payloadSizes } from '../test/helpers/recap-fixture-migration.js';

export { BASELINE_REF, COMPACT_REQUESTED_OPTIONS, readOriginalFixture, availabilityPlayers, migrateFixture, legacyCompact, payloadSizes } from '../test/helpers/recap-fixture-migration.js';

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const original = readOriginalFixture();
  const { settings } = JSON.parse(await readFile(new URL('../tests/fixtures/settings.json', import.meta.url), 'utf8'));
  const migrated = migrateFixture(original, settings);
  await writeFile(new URL('../tests/fixtures/recap_w7.json', import.meta.url), `${JSON.stringify(migrated, null, 2)}\n`);
  console.log(JSON.stringify({ before: payloadSizes(original), after: payloadSizes(migrated),
    before_compact_requested: payloadSizes(legacyCompact(original)),
    after_compact_requested: payloadSizes(selectRecapSections(migrated, COMPACT_REQUESTED_OPTIONS)),
    compact_requested_options: COMPACT_REQUESTED_OPTIONS,
    before_compact_only: payloadSizes(legacyCompact(original)),
    after_compact_only: payloadSizes(selectRecapSections(migrated, { compact: true })),
    counts: { lineups: migrated.team_lineups.length, gaps_before: original.injuries_and_byes.teams.reduce((total, team) => total + team.gaps.length, 0),
      gaps_after: migrated.injuries_and_byes.teams.reduce((total, team) => total + team.gaps.length, 0),
      unknown_pro_team: migrated.team_lineups.flatMap(team => [...team.starters, ...team.bench, ...team.ir]).filter(player => player.pro_team === null).length }
  }, null, 2));
}