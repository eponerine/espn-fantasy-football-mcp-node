import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const baseUrl = process.env.FF_API_BASE_URL || 'http://localhost:3000';
const fixtureDirectory = fileURLToPath(new URL('../tests/fixtures/', import.meta.url));

async function capture(path) {
  const response = await fetch(new URL(path, baseUrl), {
    headers: { accept: 'application/json' }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${text}`);
  }
  return JSON.parse(text);
}

async function writeFixture(name, value) {
  await writeFile(join(fixtureDirectory, name), `${JSON.stringify(value, null, 2)}\n`);
}

await mkdir(fixtureDirectory, { recursive: true });

const [league, settings, teamsResponse, transactions] = await Promise.all([
  capture('/league'),
  capture('/settings'),
  capture('/teams'),
  capture('/transactions?scoringPeriod=4')
]);
const teams = Array.isArray(teamsResponse) ? teamsResponse : teamsResponse.teams;
if (!Array.isArray(teams) || teams.length === 0) {
  throw new Error('/teams did not return a non-empty team list');
}

await Promise.all([
  writeFixture('league.json', league),
  writeFixture('settings.json', settings),
  writeFixture('teams.json', teamsResponse),
  writeFixture('transactions-week-4.json', transactions)
]);

for (const week of [1, 2, 3, 4]) {
  const [boxScores, scoreboard] = await Promise.all([
    capture(`/box-scores?week=${week}&includeLineup=true`),
    capture(`/scoreboard?week=${week}`)
  ]);
  await Promise.all([
    writeFixture(`box-scores-week-${week}.json`, boxScores),
    writeFixture(`scoreboard-week-${week}.json`, scoreboard)
  ]);
}

const [weekFiveMatchups, currentPowerRankings, priorPowerRankings] = await Promise.all([
  capture('/matchups?week=5'),
  capture('/power-rankings?week=4'),
  capture('/power-rankings?week=3')
]);
await Promise.all([
  writeFixture('matchups-week-5.json', weekFiveMatchups),
  writeFixture('power-rankings-week-4.json', currentPowerRankings),
  writeFixture('power-rankings-week-3.json', priorPowerRankings)
]);

await Promise.all(
  teams.map(async (team) => {
    const roster = await capture(`/roster?teamId=${team.team_id}&week=5`);
    await writeFixture(`roster-week-5-team-${team.team_id}.json`, roster);
  })
);

console.log(`Captured weeks 1-4 and ${teams.length} week-5 rosters in ${fixtureDirectory}`);