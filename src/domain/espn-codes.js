/**
 * The Rosetta Stone for ESPN's numeric enums. Served as a resource so a model can
 * decode raw settings payloads without guessing.
 */

export const ESPN_CODES = `# ESPN fantasy football code reference

## Lineup slot IDs (rosterSettings.lineupSlotCounts keys)

| ID | Slot | Meaning |
| --- | --- | --- |
| 0 | QB | Quarterback |
| 1 | TQB | Team quarterback (rare) |
| 2 | RB | Running back |
| 3 | RB/WR | Flex: RB or WR |
| 4 | WR | Wide receiver |
| 5 | WR/TE | Flex: WR or TE |
| 6 | TE | Tight end |
| 7 | OP | Offensive player / SUPERFLEX — QB is legal here |
| 8-15 | DT, DE, LB, DL, CB, S, DB, DP | Individual defensive players (IDP) |
| 16 | D/ST | Team defense and special teams |
| 17 | K | Kicker |
| 18 | P | Punter |
| 19 | HC | Head coach |
| 20 | BE | Bench — scores nothing |
| 21 | IR | Injured reserve — only OUT / INJURY_RESERVE players are legal |
| 23 | RB/WR/TE | The standard FLEX |
| 24 | ER | Extra / emergency |
| 25 | Rookie | Rookie-only slot |

A count of 2 against slot 23 means **two FLEX spots**. A non-zero count against slot 7
means the league is **superflex**, which makes quarterbacks the scarcest position.

## Injury statuses

| Status | Practical meaning |
| --- | --- |
| ACTIVE / NORMAL | Playing |
| PROBABLE | Expected to play |
| QUESTIONABLE | Genuine coin flip, resolved ~90 min before kickoff |
| DOUBTFUL | Treat as out |
| OUT | Not playing |
| INJURY_RESERVE | Out long-term, IR-slot eligible |
| SUSPENSION | Unavailable, usually not IR-eligible |

## Transaction types

DRAFT, TRADE_ACCEPT, TRADE_PROPOSAL, TRADE_DECLINE, TRADE_VETO, TRADE_UPHOLD, TRADE_ERROR,
WAIVER, WAIVER_ERROR, FREEAGENT, ROSTER, FUTURE_ROSTER, RETRO_ROSTER.

\`WAIVER_ERROR\` means a claim **failed** — usually outbid or insufficient FAAB. It is often
the most informative entry in the log, because it reveals what rivals were willing to pay.

## Activity message types

| Code | Meaning |
| --- | --- |
| 178 | Free agent added |
| 179, 181, 239 | Player dropped |
| 180 | Waiver claim added |
| 244 | Traded |

## Key scoring stat IDs

| ID | Stat |
| --- | --- |
| 3 / 4 / 20 | Passing yards / passing TD / interception thrown |
| 24 / 25 | Rushing yards / rushing TD |
| 41 or 53 | Receptions — the PPR dial (0 = standard, 0.5 = half, 1 = full) |
| 42 / 43 | Receiving yards / receiving TD |
| 72 | Fumbles lost |
| 74 / 77 / 80 | Field goals made by distance (50+, 40-49, under 40) |
| 89-92, 121-125 | Defensive points-allowed tiers |
| 128-136 | Defensive yards-allowed tiers |
| 155 | Team win |

## Gotchas

- \`active_status\` on a player initializes to \`'bye'\` and only becomes \`active\`/\`inactive\`
  once real stats exist. **Before kickoff every player looks like they are on bye.** Do not
  use it as an availability check; use \`on_bye_week\` and \`injury_status\`.
- \`projected_points\` / \`total_points\` on a roster player are **season** figures
  (scoring period 0), not this week's. Use \`avg_points\` / \`projected_avg_points\` for
  per-game comparisons, or \`get_box_scores\` for true weekly projections.
- \`percent_owned\` of -1 means ESPN reported no ownership data, not 0% ownership.`;
