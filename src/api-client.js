const SECRET_PARAMS = new Set(['espnS2', 'swid']);

export class ApiError extends Error {
  constructor(message, { status = null, url = null, body = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export function buildUrl(baseUrl, path, params = {}) {
  const url = new URL(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

/** Produces a log/error-safe URL with ESPN cookie values masked. */
export function redactUrl(url) {
  const safe = new URL(url);
  for (const key of SECRET_PARAMS) {
    if (safe.searchParams.has(key)) safe.searchParams.set(key, '***');
  }
  return safe.toString();
}

export class FantasyApiClient {
  #config;
  #cache = new Map();

  constructor(config) {
    this.#config = config;
  }

  get baseUrl() {
    return this.#config.baseUrl;
  }

  get defaults() {
    return {
      leagueId: this.#config.defaultLeagueId,
      year: this.#config.defaultYear
    };
  }

  /**
   * Fills in league scope from env and attaches ESPN cookies when this process
   * is the one holding them.
   */
  #resolveParams(params) {
    const resolved = { ...params };
    if (resolved.leagueId == null && this.#config.defaultLeagueId != null) {
      resolved.leagueId = this.#config.defaultLeagueId;
    }
    if (resolved.year == null && this.#config.defaultYear != null) {
      resolved.year = this.#config.defaultYear;
    }
    if (this.#config.espnS2) resolved.espnS2 = this.#config.espnS2;
    if (this.#config.swid) resolved.swid = this.#config.swid;
    return resolved;
  }

  #readCache(key) {
    const hit = this.#cache.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      this.#cache.delete(key);
      return null;
    }
    return hit.value;
  }

  #writeCache(key, value) {
    if (this.#cache.size > 200) this.#cache.clear();
    this.#cache.set(key, { value, expiresAt: Date.now() + this.#config.cacheTtlMs });
  }

  /**
   * GET a route on the upstream fantasy API.
   * Every upstream request re-fetches the whole league from ESPN, so identical
   * requests are served from a short-lived cache.
   */
  async get(path, params = {}, { useCache = true } = {}) {
    const url = buildUrl(this.#config.baseUrl, path, this.#resolveParams(params));
    const cacheKey = url.toString();
    const safeUrl = redactUrl(url);

    if (useCache) {
      const cached = this.#readCache(cacheKey);
      if (cached !== null) return cached;
    }

    let response;
    try {
      response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.#config.timeoutMs)
      });
    } catch (error) {
      const reason = error?.name === 'TimeoutError' ? `timed out after ${this.#config.timeoutMs}ms` : error?.message;
      throw new ApiError(`Request to ${safeUrl} failed: ${reason}`, { url: safeUrl });
    }

    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    if (!response.ok) {
      const detail = body && typeof body === 'object' && body.error ? body.error : response.statusText;
      throw new ApiError(`GET ${safeUrl} returned ${response.status}: ${detail}`, {
        status: response.status,
        url: safeUrl,
        body
      });
    }

    if (useCache) this.#writeCache(cacheKey, body);
    return body;
  }
}
