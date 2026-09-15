/**
 * Fantasy football domain knowledge served to models that may have no idea what
 * "FAAB" or "a 12-team half-PPR superflex keeper league" means.
 */

export const OVERVIEW = `# What fantasy football is

Fantasy football is a season-long game played on top of the real NFL season. A group of
people (a "league", usually 8-14 managers) drafts real NFL players onto imaginary rosters.
Each week every manager picks a starting lineup. Real-world statistics produced by those
players (yards, touchdowns, receptions, etc.) convert into fantasy points via the league's
scoring settings. Managers are paired head-to-head each week; the higher score wins.

The season in outline:
1. **Draft** (before Week 1) — snake or auction. Everyone fills a roster.
2. **Regular season** (roughly NFL Weeks 1-14) — weekly head-to-head matchups; managers
   set lineups, add/drop players off the waiver wire, and trade.
3. **Playoffs** (roughly NFL Weeks 15-17) — top 4-6 teams by record bracket off.
   Single elimination. Everything before this only matters as seeding.
4. **Offseason** — only for keeper/dynasty leagues.

What actually decides outcomes: draft capital, weekly lineup decisions (start/sit), waiver
wire aggression, injury luck, and schedule luck. A team can score the most points all year
and still miss the playoffs; that is normal and a constant source of complaint.`;

export const SCORING = `# Scoring formats

- **Standard**: no points for catches. Roughly 1 pt per 10 rushing/receiving yards,
  1 pt per 25 passing yards, 6 pts per rushing/receiving TD, 4 pts per passing TD,
  -2 per interception/fumble lost.
- **PPR (Point Per Reception)**: +1 per catch. Massively boosts pass-catching RBs and
  slot WRs.
- **Half-PPR**: +0.5 per catch. The most common modern default.
- **TE premium**: extra points per TE reception, to prop up a thin position.
- **Bonuses**: many leagues add yardage bonuses (e.g. +3 at 100 rushing yards).

Scoring format changes player value more than almost anything else. Never evaluate a
player without first checking the league's actual scoring settings.`;

export const POSITIONS = `# Positions and lineup slots

Roster positions: QB, RB, WR, TE, K (kicker), D/ST (team defense/special teams). Some
leagues use individual defensive players (IDP: DL, LB, DB).

Lineup slots:
- **FLEX**: usually RB/WR/TE.
- **SUPERFLEX (OP)**: QB/RB/WR/TE. Makes QBs enormously valuable — in superflex, the
  top ~20 QBs go early and often first overall.
- **BENCH (BE)**: players you hold but do not start. Score nothing.
- **IR**: an extra slot for injured players so they do not eat a bench spot.

A common starting lineup: QB, 2 RB, 2 WR, TE, FLEX, K, D/ST.`;

export const ROSTER_MANAGEMENT = `# Roster management concepts

- **Waiver wire**: the pool of unrostered players. Claims process on a schedule (often
  Wednesday morning) rather than first-come-first-served.
- **Waiver priority / rolling list**: worst record or last-claim-used gets first crack.
- **FAAB (Free Agent Acquisition Budget)**: a blind-bid budget (typically $100 for the
  whole season) spent on waiver claims. Bidding strategy is a whole discipline —
  overpay for league-winning breakouts, nibble ($1-3) for lottery tickets.
- **Free agent**: after waivers clear, players are first-come-first-served.
- **Streaming**: rotating a low-investment position (K, D/ST, sometimes QB/TE) weekly
  based on matchup instead of rostering a fixed starter.
- **Handcuff**: the backup to a star RB, held as insurance.
- **Stashing**: rostering an injured or suspended player for later payoff.
- **Bye week**: each NFL team has one week off. Players on bye score zero — the single
  most common cause of accidentally starting a dead lineup slot.`;

export const INJURIES = `# Injury designations

- **Q (Questionable)**: roughly a coin flip, usually resolved ~90 minutes before kickoff.
- **D (Doubtful)**: unlikely to play; treat as out.
- **O (Out)**: not playing.
- **IR (Injured Reserve)**: out for an extended period; eligible for an IR roster slot.
- **PUP / NFI / SUSP**: unavailable for other administrative reasons.

Practical rule: never leave a Questionable player in a starting lineup without a plan,
and always check inactives before the early window kicks off.`;

export const STRATEGY = `# Strategy vocabulary

- **ADP (Average Draft Position)**: where a player typically gets drafted; the baseline
  for judging value.
- **Value / reach**: taking a player later or earlier than ADP.
- **Zero-RB / Hero-RB / Robust-RB**: draft philosophies about how much early capital to
  spend on running backs.
- **Buy low / sell high**: trading based on the gap between recent results and true talent.
- **Regression to the mean**: unsustainable TD rates and target shares normalize. A
  player scoring on 20% of his touches will stop; a good player with no TDs will start.
- **Target share / snap share / route participation**: opportunity metrics. Opportunity
  is more predictive than efficiency.
- **Strength of schedule (SOS)**: quality of upcoming defensive matchups, especially
  important for playoff weeks 15-17.
- **Points For (PF) vs Points Against (PA)**: PF measures how good a team is; a high PA
  with a bad record means the team is unlucky, not bad.
- **Expected wins / all-play record**: what the record would be if every team played
  every other team each week. The best luck-adjusted quality measure.
- **Power rankings**: quality estimate blending record, points, and recent form —
  intentionally different from the standings.`;

export const LEAGUE_TYPES = `# League types

- **Redraft**: rosters reset every season. The default.
- **Keeper**: hold 1-3 players into next season, often at a draft-pick or salary cost.
- **Dynasty**: hold the entire roster forever; rookie drafts each year; future picks are
  tradable assets.
- **Best ball**: no lineup decisions — the optimal lineup is scored automatically.
- **Auction**: instead of a snake draft, managers bid a budget on each player.
- **Guillotine, survivor, vampire**: novelty formats.`;

export const GLOSSARY_SECTIONS = {
  overview: OVERVIEW,
  scoring: SCORING,
  positions: POSITIONS,
  roster_management: ROSTER_MANAGEMENT,
  injuries: INJURIES,
  strategy: STRATEGY,
  league_types: LEAGUE_TYPES
};

export const FULL_GLOSSARY = Object.values(GLOSSARY_SECTIONS).join('\n\n---\n\n');
