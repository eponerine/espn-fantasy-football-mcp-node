# ESPN Fantasy Football MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that puts an ESPN fantasy
football league in front of an LLM. It is a thin, read-only client for
[`espn-fantasy-football-api-node`](https://github.com/eponerine/espn-fantasy-football-api-node)
and exposes every route in that API's OpenAPI spec as an MCP tool, plus fantasy-football
domain knowledge and ready-made prompts for the questions managers actually ask.

- Runtime: Node.js 22 LTS+
- SDK: `@modelcontextprotocol/server` v2 (stdio and Streamable HTTP transports)
- Schemas: Zod v4
- No build step — plain ESM JavaScript

## Architecture

```
MCP host (VS Code / Claude / Cursor / Remote agent)
        |  stdio (JSON-RPC) OR Streamable HTTP (POST /mcp)
        v
espn-fantasy-football-mcp-node   <-- this repo
        |  HTTP (fetch)
        v
espn-fantasy-football-api-node   <-- your Express API
        |
        v
    ESPN fantasy endpoints
```

This server holds no ESPN logic of its own. It adds schemas, descriptions, caching,
credential hygiene and fantasy-football context on top of your HTTP API.

## Setup

```powershell
npm install
Copy-Item .env.example .env
```

Start your fantasy API first (it must be reachable at `FF_API_BASE_URL`):

```powershell
cd ..\espn-fantasy-football-api-node
npm start
```

### Running with stdio (Default)

The default launch mode is `stdio`, preserving backward compatibility:

```powershell
npm start
```

Or explicitly specify the transport via CLI:

```powershell
node src/index.js --transport=stdio
```

It waits on stdin — that is correct for stdio servers. To poke at it interactively:

```powershell
npm run inspect
```

### Running with Streamable HTTP

Streamable HTTP exposes an authenticated HTTP MCP service on `/mcp`.

Start HTTP using CLI arguments (CLI options take precedence over environment variables):

```powershell
node src/index.js --transport=streamable-http --host=127.0.0.1 --port=3001
```

Or via environment variables:

```powershell
$env:MCP_TRANSPORT = "streamable-http"
$env:MCP_HOST = "127.0.0.1"
$env:MCP_PORT = "3001"
$env:MCP_AUTH_TOKEN = "your-secure-token"
$env:MCP_ALLOWED_HOSTS = "localhost,127.0.0.1"
npm start
```

Or using the npm script shortcut:

```powershell
npm run start:http
```

For local development without manual token setup, a helper script is available:

```powershell
node scripts/start-local-http.js
```

This helper generates an ephemeral token if `MCP_AUTH_TOKEN` is unset and binds to loopback (or respects caller-provided `MCP_HOST`, `MCP_PORT`, and `MCP_ALLOWED_HOSTS`).

#### HTTP Endpoints and Security

- **MCP Endpoint**: `POST /mcp` — handles streamable JSON-RPC requests. Requires the `Authorization: Bearer <MCP_AUTH_TOKEN>` header and a matching `Host` header listed in `MCP_ALLOWED_HOSTS`. Non-POST requests return `405 Method Not Allowed`.
- **Health & Readiness Check**: `GET /healthz` — unauthenticated probe that returns `200` with `{"status":"ok"}` when healthy and accepting requests, and `503` with `{"status":"draining"}` during shutdown.
- **Security Protections**: HTTP mode requires `MCP_AUTH_TOKEN` and `MCP_ALLOWED_HOSTS`. If either is missing, the server fails immediately at startup with an informative error rather than silently disabling authentication. Optional `MCP_ALLOWED_ORIGINS` restricts browser CORS origins.
- **Host Binding**: Set `--host` or `MCP_HOST` to `127.0.0.1` for local loopback (default) or `0.0.0.0` for containerized environments.
- **Graceful Shutdown**: On `SIGTERM` or `SIGINT`, the HTTP server immediately enters draining mode (`/healthz` returns `503`), stops accepting new connections, drains existing in-flight tool requests, and closes idle keep-alive connections. Active requests are allowed up to `MCP_SHUTDOWN_TIMEOUT_MS` (default 55s) before connections are closed.

### Container Deployment

When running this server as a container service alongside your fantasy API:

1. **Container Command**: `node src/index.js`
2. **Required Environment Variables**:
   - `MCP_TRANSPORT=streamable-http`
   - `MCP_HOST=0.0.0.0` (binds all container interfaces)
   - `MCP_PORT=3001`
   - `MCP_AUTH_TOKEN=<your-token>` (required bearer token)
   - `MCP_ALLOWED_HOSTS=<service-name>,localhost,127.0.0.1` (accepted `Host` headers)
   - `FF_API_BASE_URL=http://<api-service>:3000`
3. **Container Runtime Recommendations**:
   - Enable init process (`init: true` in Compose or `docker run --init`) so Node.js receives `SIGTERM` and `SIGINT` signals properly.
   - Set container stop grace period to at least `60s` (`stop_grace_period: 60s`) so the default 55-second draining deadline can finish in-flight tool executions before `SIGKILL`.
   - Add a healthcheck targeting `GET /healthz`:
     ```yaml
     healthcheck:
       test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:'+(process.env.MCP_PORT||3001)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
       interval: 30s
       timeout: 5s
       retries: 3
       start_period: 10s
     ```

Example Compose service definition:

```yaml
services:
  fantasy-mcp:
    build: .
    init: true
    restart: unless-stopped
    stop_grace_period: 60s
    environment:
      MCP_TRANSPORT: streamable-http
      MCP_HOST: 0.0.0.0
      MCP_PORT: "3001"
      MCP_AUTH_TOKEN: ${MCP_AUTH_TOKEN:?Set MCP_AUTH_TOKEN}
      MCP_ALLOWED_HOSTS: fantasy-mcp,localhost,127.0.0.1
      FF_API_BASE_URL: http://fantasy-api:3000
    expose:
      - "3001"
```

## Configuration

### Upstream Fantasy API

| Variable | Default | Purpose |
| --- | --- | --- |
| `FF_API_BASE_URL` | `http://localhost:3000` | Base URL of the fantasy HTTP API. Must be `http`/`https`. |
| `LEAGUE_ID` | — | Default league. Tools may override it per call. |
| `SEASON_YEAR` | — | Default season year. |
| `ESPN_S2` | — | Private-league cookie. Prefer setting this on the API server instead. |
| `SWID` | — | Private-league cookie. Prefer setting this on the API server instead. |
| `FF_API_TIMEOUT_MS` | `20000` | Per-request timeout. |
| `FF_CACHE_TTL_MS` | `60000` | TTL for the in-memory response cache. |

### MCP Runtime & Transport

| Variable | CLI Option | Default | Purpose |
| --- | --- | --- | --- |
| `MCP_TRANSPORT` | `--transport` | `stdio` | Transport type: `stdio` or `streamable-http`. CLI takes precedence. |
| `MCP_HOST` | `--host` | `127.0.0.1` | Bind host for HTTP mode. Use `0.0.0.0` for containers. |
| `MCP_PORT` | `--port` | `3001` | Listen port for HTTP mode. |
| `MCP_AUTH_TOKEN` | — | — | Required bearer token for `/mcp` in HTTP mode. |
| `MCP_ALLOWED_HOSTS` | — | — | Required comma-separated hostnames accepted in `Host` header. |
| `MCP_ALLOWED_ORIGINS` | — | — | Optional comma-separated allowed browser origins for CORS. |
| `MCP_SHUTDOWN_TIMEOUT_MS` | — | `55000` | Grace period in milliseconds to drain requests during shutdown. |
| `MCP_MAX_CONCURRENT_REQUESTS` | — | `16` | Maximum concurrent in-flight HTTP requests before returning 503. |

Environment variables are read from the process environment. Set them in your MCP client
config (see `.vscode/mcp.json`) or export them in the shell — this server does not read
`.env` itself, so use `node --env-file=.env src/index.js` if you want that.

## Integrating into Host Applications

### Claude Desktop

Modify your `claude_desktop_config.json` file to include the following at the top of the JSON document. You can optionally include the `env` variables here but it's recommended to have them configured in the API itself:

```
{
  "mcpServers": {
    "espn-fantasy-football": {
      "command": "cmd.exe",
      "args": [
        "/c",
        "npm",
        "start",
        "--prefix",
        "C:\\Git\\espn-fantasy-football-mcp-node"
      ],
      "env": {
        "LEAGUE_ID": "123456",
        "SEASON_YEAR": "2026",
        "ESPN_S2": "xxxxxxxxxxxxxxxxxxx",
        "SWID": "{3ac98880-8984-4546-8dab-cdb22e4cc387}"
      }
    }
  },  
  "preferences": {
  ...
  <snip>
  ...
}
```

## Tools

Every route in the upstream OpenAPI spec is covered.

| Tool | Route | What it is for |
| --- | --- | --- |
| `get_health` | `/health` | Is the API up? Diagnose failures before blaming league config. |
| `get_league` | `/league` | League name, team count, **current week**. Call this first. |
| `get_settings` | `/settings` | Scoring format, lineup slots, playoff rules, waiver/FAAB rules. |
| `get_teams` | `/teams` | Team ids, names, records, PF/PA, divisions. Name → id lookup. |
| `get_standings` | `/standings` | Ranked records and points for. |
| `get_power_rankings` | `/power-rankings` | Quality estimate that ignores schedule luck. |
| `get_draft` | `/draft` | Every pick, bid amount and keeper status. |
| `get_roster` | `/roster` | One team's roster for one week, with slots and injury status. |
| `get_scoreboard` | `/scoreboard` | Head-to-head scores for a week. |
| `get_matchups` | `/matchups` | Schedule plus matchup type (regular / playoff / consolation). |
| `get_box_scores` | `/box-scores` | Per-player actual vs projected points. The analysis workhorse. |
| `get_transactions` | `/transactions` | Waiver claims, adds, drops, trades, FAAB bids. |
| `get_activity` | `/activity` | Chronological league activity feed. |
| `get_free_agents` | `/free-agents` | Waiver wire and free agents, filterable by position. |
| `get_player_info` | `/player-info` | Player card by name or ESPN player id. |
| `get_league_profile` | *composite* | **Start here.** Raw ESPN settings translated into plain English. |
| `check_lineup` | *composite* | Lineup legality and optimization audit against the league's real slots. |
| `get_injury_report` | *composite* | Non-healthy designations among the top-N season scorers, injury timing from game logs, and positions each team must fill. Cached 30 min per league/week. |
| `get_recap_data` | *composite* | Full deterministic weekly recap JSON with scoring, standings, all-play, optimal lineups, transactions, availability, power rankings and validation. |
| `get_all_play` | *composite* | All-play records, expected wins and luck delta. |
| `get_bench_analysis` | *composite* | Optimal lineups, points left on the bench, swaps and result what-ifs. |
| `get_faab_summary` | *composite* | Deduplicated executed/failed claims, FAAB totals and bidding wars. |
| `get_availability` | *composite* | Next-week roster byes, injury statuses and positional coverage facts. |
| `get_recap_validation` | *composite* | Recap reconciliation checks, including any failures. |
| `explain_fantasy_football` | — | Fantasy primer: formats, scoring, slots, waivers, jargon. |
| `how_to_answer` | — | Which tools to combine for common question types. |

`leagueId` and `year` are optional on every tool and fall back to `LEAGUE_ID` / `SEASON_YEAR`.

### Deterministic weekly recaps

`get_recap_data` accepts optional `week` and `include_preview` fields. If `week` is omitted, it
uses the last completed regular-season week. It returns the league and team identities, `week_summary`,
`scoreboard`, `standings`, `season_summary`, player highlights and callbacks, `bench_analysis`,
`roster_moves`, `injuries_and_byes`, `power_rankings`, `preview`, and `validation`. Numeric results
are computed by pure functions under `recap/`; points are accumulated in cents and rounded only for
output. Check `validation.passed` before writing commentary. The `weekly_recap` prompt contains the
required writing format and tells the writing model to compute no numbers itself.

The recap fetches each scoring week once per request, then requests all next-week rosters together.
Its tool calls leave league IDs and ESPN cookies out of the request so a preconfigured upstream API
can supply them. Existing tools keep their normal client defaults. Team-name snapshots are stored in
`.recap-team-name-snapshots.json` (or the path in `RECAP_TEAM_NAME_CACHE`) for rename detection.
Teams and rosters endpoints in some API builds do not expose owner display names; those are returned
as `null` when unavailable.

The top-level JSON shape is:

```json
{
  "meta": {},
  "teams": [],
  "week_summary": {},
  "scoreboard": [],
  "standings": [],
  "season_summary": {},
  "players": { "studs": [], "duds": [], "bench_top": [], "qb_flips": [] },
  "bench_analysis": { "teams": [], "league_total_left": 0, "what_ifs": [] },
  "roster_moves": { "teams": [], "bidding_wars": [], "league_faab_total": 0 },
  "injuries_and_byes": { "bye_teams": [], "teams": [] },
  "power_rankings": [],
  "preview": [],
  "validation": { "passed": true, "checks": [] }
}
```

Refresh live raw-response fixtures while the local API is running on port 3000:

```powershell
node scripts/refresh-recap-fixtures.js
```

This captures weeks 1-4, week 4 transactions, week 5 matchups/rankings and every team roster for
week 5 under `tests/fixtures/`. The fixture files are raw API JSON; the test suite uses them for the
week 4 golden values and lineup solver cross-checks.

### The interpreter tools

ESPN speaks in integers: scoring is `statId` → points, lineups are `slotId` → count. Neither is
usable by a model without translation, and the failure mode is silent — a league with two FLEX
spots and an IR slot looks identical to a standard league until you decode slot IDs 23 and 21.

**`get_league_profile`** does that decoding in one call:

- **Scoring** — PPR value (standard / half / full / custom), passing-TD value, interception
  penalty, active yardage bonuses, and every scoring rule grouped by category. Any rule ESPN
  reports that cannot be labeled is listed explicitly rather than silently dropped.
- **Roster** — the exact starting lineup with eligible positions per slot, FLEX count, superflex
  detection, bench and IR counts, and total roster size.
- **Rules** — FAAB vs rolling waivers with budget and process day/hour, acquisition limits, trade
  deadline, veto rules, playoff team count and first playoff week, median scoring, keepers.
- **Strategic implications** — what those specific rules mean for how the league should be played.

**`check_lineup`** cross-references a roster against those slots and player availability, returning
severity-ranked issues:

| Severity | Detects |
| --- | --- |
| error | Unfilled starting slots, starters on bye, OUT/DOUBTFUL starters, a player illegally occupying IR |
| warning | Questionable starters, bench players outscoring a starter they may legally replace |
| info | Injured bench players eligible for an open IR slot |

Slot eligibility is checked against ESPN's own `eligible_slots` for each player, not against
position labels, so unusual flex configurations are handled correctly.

## Prompts

Slash-command style entry points for the questions people actually ask:

`start-sit`, `waiver-wire-targets`, `trade-evaluation`, `matchup-preview`, `weekly-recap`,
`weekly-recap-email`, `power-rankings-writeup`, `playoff-outlook`, `roster-checkup`, `draft-review`,
`league-briefing`, `explain-my-league`, `lineup-legality-check`, `ir-and-bench-optimization`,
`scoring-quirks`, `format-adjusted-rankings`.

Each one is preloaded with the answering rules — start from the league profile, never assume a
standard league, never request box scores for a future week, know whether a projection is seasonal
or weekly, separate skill from schedule luck, and do not invent NFL news.

## Resources

| URI | Contents |
| --- | --- |
| `fantasy://knowledge/glossary` | How fantasy football works, end to end. |
| `fantasy://knowledge/playbook` | Question → tool-sequence playbook. |
| `fantasy://knowledge/espn-codes` | Decoder for slot IDs, stat IDs, injury statuses, transaction types. |
| `fantasy://league/rules-digest` | The interpreted league profile. |
| `fantasy://api/openapi.json` | The live upstream OpenAPI document. |
| `fantasy://league/current` | Snapshot of the configured league. |

## Known data traps

These are encoded in the server instructions and the ESPN code reference, but are worth knowing:

- A roster player's `projected_points` and `total_points` are **season** figures (scoring period 0).
  Use `avg_points` / `projected_avg_points` per game, or `get_box_scores` with `includeLineup: true`
  for true weekly projections.
- `active_status` initializes to `'bye'` and only resolves once real stats exist, so **every player
  reads as on-bye before kickoff**. Use `on_bye_week` and `injury_status` for availability.
- `on_bye_week` is derived from the absence of a scheduled game, so missing schedule data makes an
  entire roster look like it is on bye. `check_lineup` detects this case and reports it rather than
  emitting a dozen bogus bye warnings.
- `percent_owned` of `-1` means "no data reported", not 0% ownership.

## Security notes

- **ESPN cookies are never tool inputs.** The upstream API accepts `espnS2`/`swid` as query
  parameters, but exposing them as tool arguments would put credentials into model context.
  They are read from the environment only, and are masked in every error message and log line.
- Because the upstream API takes those cookies on the query string, the safest setup is to
  configure `ESPN_S2`/`SWID` on the API server and leave them unset here.
- `FF_API_BASE_URL` is validated to `http`/`https` and has any embedded user:password stripped.
- All tools are read-only and annotated as such; nothing in this server can modify a league.
- Responses are cached in memory only, for `FF_CACHE_TTL_MS`, and never written to disk.

## Development

```powershell
npm test
```

Tests cover URL construction, credential redaction, configuration validation, league-profile
interpretation (half-PPR vs superflex detection, multi-FLEX and IR slot counts, unmapped scoring
IDs) and every lineup-audit rule.

## Upstream API requirements

`get_league_profile` and `check_lineup` need `settings.lineup_slots` from the API, which keys
lineup counts by ESPN slot ID. Against an older API build that does not expose it, both tools
degrade with an explicit warning rather than reporting wrong slot counts.
