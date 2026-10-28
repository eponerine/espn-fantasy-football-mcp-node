import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as z from 'zod/v4';
import { buildRecapData } from '../../recap/build.js';
import { RECAP_SECTIONS, selectRecapSections } from '../../recap/payload.js';
import { getRecapSchema } from '../../recap/schema.js';
import { jsonResult, READ_ONLY, safeHandler } from './shared.js';

const TEAM_NAME_CACHE = process.env.RECAP_TEAM_NAME_CACHE
  ? resolve(process.env.RECAP_TEAM_NAME_CACHE)
  : fileURLToPath(new URL('../../.recap-team-name-snapshots.json', import.meta.url));

async function readNameSnapshots() {
  try {
    return JSON.parse(await readFile(TEAM_NAME_CACHE, 'utf8'));
  } catch {
    return {};
  }
}

async function writeNameSnapshots(snapshots) {
  await mkdir(dirname(TEAM_NAME_CACHE), { recursive: true });
  const temporary = `${TEAM_NAME_CACHE}.tmp`;
  await writeFile(temporary, `${JSON.stringify(snapshots, null, 2)}\n`);
  await rename(temporary, TEAM_NAME_CACHE);
}

function collection(payload, key) {
  if (Array.isArray(payload)) return payload;
  return payload?.[key] ?? [];
}

export function createRecapHandler(client) {
  return async function getRecapData({
    week: requestedWeek, include_preview: includePreview = true, sections, compact = false,
    include_history = true, include_gap_detail = false, include_optimal_assignment = true
  } = {}) {
    if (sections?.some((section) => !RECAP_SECTIONS.includes(section))) throw new Error('Unknown recap section.');
    const requestCache = new Map();
    const get = (path, params = {}) => {
      const key = `${path}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()}`;
      if (!requestCache.has(key)) {
        requestCache.set(key, client.get(path, params, { useConfiguredScope: false }));
      }
      return requestCache.get(key);
    };

    const [league, settingsPayload, teamsPayload] = await Promise.all([
      get('/league'),
      get('/settings'),
      get('/teams')
    ]);
    const settings = settingsPayload.settings ?? settingsPayload;
    const teams = collection(teamsPayload, 'teams');
    if (!teams.length) throw new Error('The configured API returned no teams.');
    const regularSeasonWeeks = Number(settings.reg_season_count) || Number(league.current_week) - 1;
    const defaultWeek = Math.max(1, Math.min(Number(league.current_week) - 1, regularSeasonWeeks));
    const week = requestedWeek ?? defaultWeek;
    if (week > Number(league.current_week)) {
      throw new Error(`Week ${week} has not completed; current league week is ${league.current_week}.`);
    }

    const boxScoresByWeek = await Promise.all(Array.from({ length: week }, (_, index) => index + 1)
      .map((scoringWeek) => get('/box-scores', { week: scoringWeek, includeLineup: true })));
    const nextWeek = week + 1;
    const rosterResponses = await Promise.all(teams.map((team) => get('/roster', { teamId: team.team_id, week: nextWeek })));
    const [transactionPayload, previewPayload, powerPayload, priorPowerPayload, pendingPayload] = await Promise.all([
      get('/transactions', { scoringPeriod: week }),
      includePreview ? get('/matchups', { week: nextWeek }) : Promise.resolve(null),
      get('/power-rankings', { week }),
      week > 1 ? get('/power-rankings', { week: week - 1 }) : Promise.resolve(null),
      get('/transactions', { scoringPeriod: nextWeek })
    ]);
    if (!Array.isArray(pendingPayload) && !Array.isArray(pendingPayload?.transactions)) {
      throw new Error('Next-week transaction response did not contain a transactions array.');
    }
    const matchupsArePlayoffs = collection(boxScoresByWeek.at(-1), 'box_scores').some((matchup) => matchup.is_playoff);
    const regularSeason = week <= regularSeasonWeeks && !matchupsArePlayoffs;
    const snapshots = await readNameSnapshots();
    const scopeKey = `${league.league_id ?? 'default'}:${league.year ?? league.season ?? 'unknown'}`;
    const leagueSnapshots = snapshots[scopeKey] ?? {};
    const recap = buildRecapData({
      league,
      settings,
      teams,
      week,
      regularSeason,
      include_gap_detail,
      boxScoresByWeek,
      rosterResponses,
      transactions: collection(transactionPayload, 'transactions'),
      pendingTransactions: collection(pendingPayload, 'transactions'),
      previewMatchups: collection(previewPayload, 'matchups'),
      espnPowerRankings: powerPayload,
      espnPriorPowerRankings: priorPowerPayload,
      nameSnapshots: leagueSnapshots
    });
    leagueSnapshots[String(week)] = recap.name_snapshot;
    const retainedWeeks = Object.keys(leagueSnapshots).map(Number).sort((left, right) => right - left).slice(0, 3);
    const retained = Object.fromEntries(retainedWeeks.map((snapshotWeek) => [String(snapshotWeek), leagueSnapshots[String(snapshotWeek)]]));
    await writeNameSnapshots({ ...snapshots, [scopeKey]: retained });
    delete recap.name_snapshot;
    return selectRecapSections(recap, { sections, compact, include_history, include_gap_detail, include_optimal_assignment });
  };
}

const weekSchema = z.number().int().min(1).optional();
const recapInput = z.object({
  week: weekSchema,
  include_preview: z.boolean().optional().default(true),
  sections: z.array(z.enum(RECAP_SECTIONS)).optional().describe('Top-level sections to return; meta and schema_version are always retained, with team_lineups_week and pending_claims_meta alongside their sections.'),
  include_history: z.boolean().optional().default(true).describe('Include historical recap detail.'),
  include_gap_detail: z.boolean().optional().default(false).describe('Include every starting-slot gap assessment, including non-actionable rows.'),
  include_optimal_assignment: z.boolean().optional().default(true).describe('Include bench analysis optimal_assignment and its deprecated assignment alias.'),
  compact: z.boolean().optional().default(false).describe('Omit null-valued object fields recursively; preserve all numeric values and arrays.')
});

export function registerRecapTools(server, client) {
  const handler = createRecapHandler(client);
  server.registerTool('get_recap_schema', {
    title: 'Recap JSON schema', description: 'Return the versioned recap payload JSON schema, section names and field semantics.',
    inputSchema: z.object({}), annotations: READ_ONLY
  }, safeHandler(async () => jsonResult(getRecapSchema())));
  server.registerTool(
    'get_recap_data',
    {
      title: 'Deterministic weekly recap data',
      description: 'Compute a complete, validated weekly recap dataset from league scores, rosters and transactions.',
      inputSchema: recapInput,
      annotations: READ_ONLY
    },
    safeHandler(async (args) => jsonResult(await handler(args)))
  );

  const sections = [
    ['get_all_play', 'all-play standings and expected wins', (data) => data.standings.map((row) => ({
      team_id: row.team_id, team: row.name, record: row.all_play, win_pct: row.all_play_win_pct,
      expected_wins: row.expected_wins, luck_delta: row.luck_delta
    }))],
    ['get_bench_analysis', 'optimal lineups, bench points and what-if results', (data) => data.bench_analysis],
    ['get_faab_summary', 'deduplicated FAAB claims and bidding wars', (data) => data.roster_moves],
    ['get_availability', 'next-week roster injuries, byes and position gaps', (data) => data.injuries_and_byes],
    ['get_recap_validation', 'reconciliation checks for the recap dataset', (data) => data.validation]
  ];
  for (const [name, description, select] of sections) {
    server.registerTool(
      name,
      { title: description, description: `Return ${description} for a recap week.`, inputSchema: z.object({ week: weekSchema }), annotations: READ_ONLY },
      safeHandler(async ({ week }) => jsonResult(select(await handler({ week, include_preview: false }))))
    );
  }
}