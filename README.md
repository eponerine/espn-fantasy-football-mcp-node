# ESPN Fantasy Football MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that puts an ESPN fantasy
football league in front of an LLM. It is a thin, read-only client for
[`espn-fantasy-football-api-node`](https://github.com/eponerine/espn-fantasy-football-api-node)
and exposes every route in that API's OpenAPI spec as an MCP tool, plus fantasy-football
domain knowledge and ready-made prompts for the questions managers actually ask.

- Runtime: Node.js 22 LTS+
- SDK: `@modelcontextprotocol/server` v2 (stdio transport)
- Schemas: Zod v4
- No build step — plain ESM JavaScript

## Architecture

```
MCP host (VS Code / Claude / Cursor)
        |  stdio (JSON-RPC)
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

Then run the MCP server:

```powershell
npm start
```

It waits on stdin — that is correct for stdio servers. To poke at it interactively:

```powershell
npm run inspect
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `FF_API_BASE_URL` | `http://localhost:3000` | Base URL of the fantasy HTTP API. Must be `http`/`https`. |
| `LEAGUE_ID` | — | Default league. Tools may override it per call. |
| `SEASON_YEAR` | — | Default season year. |
| `ESPN_S2` | — | Private-league cookie. Prefer setting this on the API server instead. |
| `SWID` | — | Private-league cookie. Prefer setting this on the API server instead. |
| `FF_API_TIMEOUT_MS` | `20000` | Per-request timeout. |
| `FF_CACHE_TTL_MS` | `60000` | TTL for the in-memory response cache. |

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
| `explain_fantasy_football` | — | Fantasy primer: formats, scoring, slots, waivers, jargon. |
| `how_to_answer` | — | Which tools to combine for common question types. |

`leagueId` and `year` are optional on every tool and fall back to `LEAGUE_ID` / `SEASON_YEAR`.

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
`power-rankings-writeup`, `playoff-outlook`, `roster-checkup`, `draft-review`,
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
