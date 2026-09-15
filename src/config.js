const DEFAULT_BASE_URL = 'http://localhost:3000';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_CACHE_TTL_MS = 60_000;

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBaseUrl(value) {
  const raw = value || DEFAULT_BASE_URL;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`FF_API_BASE_URL is not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`FF_API_BASE_URL must use http or https, got ${url.protocol}`);
  }
  // Credentials belong in ESPN_S2/SWID, never embedded in the base URL.
  url.username = '';
  url.password = '';
  return url.toString().replace(/\/+$/, '');
}

export function loadConfig(env = process.env) {
  return {
    baseUrl: parseBaseUrl(env.FF_API_BASE_URL),
    defaultLeagueId: env.LEAGUE_ID ? Number(env.LEAGUE_ID) : null,
    defaultYear: env.SEASON_YEAR ? Number(env.SEASON_YEAR) : null,
    espnS2: env.ESPN_S2 || null,
    swid: env.SWID || null,
    timeoutMs: parseNumber(env.FF_API_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    cacheTtlMs: parseNumber(env.FF_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS)
  };
}
