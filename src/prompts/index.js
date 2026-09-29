import * as z from 'zod/v4';
import { ANSWERING_RULES } from '../domain/playbook.js';

// MCP prompt arguments arrive as strings, so every argsSchema field is a string.
const optionalString = (description) => z.string().optional().describe(description);

const TEAM_HINT =
  'If a team is named rather than numbered, call get_teams first and match the name yourself.';

function userMessage(text) {
  return { role: 'user', content: { type: 'text', text } };
}

function withRules(body) {
  return { messages: [userMessage(`${ANSWERING_RULES}\n\n---\n\n${body}`)] };
}

export function registerPrompts(server) {
  server.registerPrompt(
    'start-sit',
    {
      title: 'Start/sit advice',
      description: 'Decide which players to start for a team this week.',
      argsSchema: z.object({
        team: z.string().describe('Team name or numeric team id to advise.'),
        week: optionalString('Week to set a lineup for. Defaults to the current week.'),
        position: optionalString('Limit the analysis to one position, e.g. RB or FLEX.')
      })
    },
    ({ team, week, position }) =>
      withRules(
        [
          `Give start/sit advice for team "${team}"${week ? ` in week ${week}` : ' for the current week'}${
            position ? `, focused on the ${position} slot(s)` : ''
          }.`,
          TEAM_HINT,
          'Steps: call get_league_profile for the current week, scoring format and the real lineup',
          'slots, then check_lineup to catch bye-week starters, OUT players, empty slots and bench',
          'players outscoring starters. Confirm close calls with get_box_scores includeLineup=true,',
          'which is the only source of true weekly projections.',
          'Produce a recommended starting lineup, then a short ranked list of the close calls with',
          'one sentence of reasoning each. Say plainly when two options are a coin flip.'
        ].join(' ')
      )
  );

  server.registerPrompt(
    'waiver-wire-targets',
    {
      title: 'Waiver wire targets',
      description: 'Find the best available pickups and who to drop for them.',
      argsSchema: z.object({
        team: optionalString('Team name or id to tailor recommendations to.'),
        week: optionalString('Week to target. Defaults to the current week.'),
        position: optionalString('Position of need, e.g. RB, WR, TE, QB, K, D/ST.'),
        faabBudget: optionalString('Remaining FAAB budget, if the league uses blind bidding.')
      })
    },
    ({ team, week, position, faabBudget }) =>
      withRules(
        [
          `Recommend waiver wire pickups${team ? ` for team "${team}"` : ''}${
            week ? ` in week ${week}` : ''
          }${position ? `, prioritizing ${position}` : ''}.`,
          'Use get_free_agents (raise size to scan deep) and get_settings to respect the scoring format.',
          team ? `Use get_roster to find the weakest droppable player. ${TEAM_HINT}` : '',
          'Check get_transactions to see what rivals recently paid for similar players.',
          faabBudget
            ? `Suggest a FAAB bid as a percentage of the ${faabBudget} remaining, and justify it.`
            : 'If the league uses FAAB, suggest bid ranges as a percentage of a season budget.',
          'Rank 3-5 targets: name, position, why now, confidence, and the corresponding drop.'
        ]
          .filter(Boolean)
          .join(' ')
      )
  );

  server.registerPrompt(
    'trade-evaluation',
    {
      title: 'Evaluate a trade',
      description: 'Judge whether a proposed trade helps or hurts.',
      argsSchema: z.object({
        myTeam: z.string().describe('Your team name or id.'),
        otherTeam: z.string().describe('The other team name or id.'),
        giving: z.string().describe('Players you would give up, comma separated.'),
        receiving: z.string().describe('Players you would receive, comma separated.')
      })
    },
    ({ myTeam, otherTeam, giving, receiving }) =>
      withRules(
        [
          `Evaluate this trade: team "${myTeam}" gives ${giving} to team "${otherTeam}" and receives ${receiving}.`,
          TEAM_HINT,
          'Pull both rosters with get_roster, the scoring rules with get_settings, and the standings',
          'with get_standings. Use get_player_info for any player you need detail on.',
          'Judge by projected starting-lineup improvement, not by counting players: in 2-for-1 deals',
          'the side getting the best player usually wins. Account for positional scarcity, bye-week',
          'overlap, injury risk, remaining schedule and each team\'s playoff position.',
          'Finish with a clear verdict (accept / decline / counter) and, if countering, name the',
          'specific counter-offer.'
        ].join(' ')
      )
  );

  server.registerPrompt(
    'matchup-preview',
    {
      title: 'Matchup preview',
      description: 'Preview a weekly head-to-head matchup.',
      argsSchema: z.object({
        team: optionalString('Team name or id to preview. Omit to preview every matchup.'),
        week: optionalString('Week to preview. Defaults to the current week.')
      })
    },
    ({ team, week }) =>
      withRules(
        [
          `Preview ${team ? `the matchup for team "${team}"` : 'every matchup'}${
            week ? ` in week ${week}` : ' this week'
          }.`,
          'Use get_matchups for the schedule and get_box_scores with includeLineup=true for projected',
          'lineups (only for weeks up to current_week).',
          'For each matchup give projected scores, the biggest positional edge for each side, the',
          'swing players who decide it, and a confidence level.'
        ].join(' ')
      )
  );

  server.registerPrompt(
    'weekly-recap',
    {
      title: 'Weekly recap / league newsletter',
      description: 'Write an entertaining recap of the week.',
      argsSchema: z.object({
        week: optionalString('Week to recap. Defaults to the most recently completed week.'),
        tone: optionalString('Tone to write in: analytical, snarky, broadcast, or roast.')
      })
    },
    ({ week, tone }) =>
      withRules(
        [
          `Write a league recap for ${week ? `week ${week}` : 'the most recently completed week'}`,
          `in a ${tone || 'snarky but fair'} tone.`,
          'Use get_scoreboard, get_box_scores with includeLineup=true, get_standings, get_power_rankings',
          'and get_activity.',
          'Cover: highest and lowest scorers, closest and most lopsided matchups, the worst bench',
          'blunder (a bench player who outscored a starter at the same position), the best waiver',
          'pickup of the week, how injuries played into things (FAAB pickups, Free Agency, starts), and how the playoff picture shifted.',
          'Use real numbers from the tools. Do not invent NFL news, and make sure to reference',
          'injury status based on the date of the matchup, not the time the recap is ran.'
        ].join(' ')
      )
  );

  server.registerPrompt(
    'weekly-recap-email',
    {
      title: 'Weekly recap email',
      description:
        'Full commissioner-style recap email: boom/bust vs projections, bench blunders, a sorted power-rankings table and next week\'s projected matchups.',
      argsSchema: z.object({
        week: optionalString('Week to recap. Defaults to the most recently completed week.'),
        tone: optionalString('Tone to write in: analytical, snarky, broadcast, or roast.'),
        team: optionalString('Team name or id to give a little extra attention to, if any.')
      })
    },
    ({ week, tone, team }) =>
      withRules(
        [
          `Write a weekly recap EMAIL for ${week ? `week ${week}` : 'the most recently completed week'}`,
          `in a ${tone || 'snarky but fair'} tone. Output a subject line, then the body in Markdown`,
          'with the sections below in order. Every number must come from a tool call; never invent',
          'NFL news, injuries or weather.',
          team ? `Give team "${team}" a little extra attention. ${TEAM_HINT}` : '',

          '\n\nDATA GATHERING (do this before writing anything):',
          '1. get_league for current_week so you know which week is actually complete.',
          '2. get_league_profile for scoring format, starting lineup slots, playoff structure, and',
          'especially the median_scoring flag.',
          '3. get_box_scores with includeLineup=true for the recap week — this is the only source of',
          'per-player actual vs projected points.',
          '4. get_standings, get_teams and get_power_rankings for records, PF/PA and rankings.',
          '5. get_power_rankings again for the PRIOR week so you can compute rank movement.',
          '6. get_activity for waiver and trade context.',
          '7. get_matchups (and get_scoreboard) for the NEXT week\'s schedule. If next week is beyond',
          'current_week, get_box_scores will fail for it — use get_matchups plus season-level roster',
          'strength instead and say the projections are estimates.',

          '\n\nSECTION 1 — Scoreboard recap. For each matchup: final score, the margin, and a one or',
          'two sentence story. Call out the highest and lowest scorer of the week, the closest game',
          'and the biggest blowout.',

          '\n\nSPECIAL CALLOUT — immediately after the scoreboard recap, set off a short highlighted',
          'callout block (blockquote or bold header) crowning the week\'s top scorer: the team with the',
          'most total points, their exact score, the margin over the second-highest team, and how that',
          'score compares to their season average and to the league\'s best score of the season so far.',
          'Also name the season-to-date total points (PF) leader in the same block, and say whether',
          'that is the same team. Keep it to three or four punchy sentences.',

          '\n\nSECTION 2 — Boom / bust vs projection. Using the includeLineup box scores, compute for',
          'every STARTER: actual minus projected points, and the percentage of projection hit.',
          'Present a "Booms" table (top 5 overperformers) and a "Busts" table (bottom 5) with',
          'columns: Player, Pos, Team (fantasy manager), Proj, Actual, +/-, % of Proj.',
          'Also give each fantasy team\'s total actual vs total projected so readers can see who got',
          'lucky and who got robbed. Make sure to check injury news and include where needed.',

          '\n\nSECTION 3 — Bench blunders. For each team, find bench players who outscored a starter',
          'that they were slot-eligible to replace (use the league profile lineup slots to check',
          'eligibility — do not claim a TE could have started at RB). Show: Manager, Benched Player',
          '(points), Started Player (points), Points Left On Bench. Then name the single worst',
          'blunder of the week and what the optimal lineup score would have been versus the actual',
          'score for that team. Call out injuries if they occurred during a game. Or if someone',
          'started an injured player and should not have',

          '\n\nSECTION 4 — Median / top-half scoring check. Read median_scoring from get_league_profile.',
          'If it is TRUE, this league awards a bonus WIN to every team in the top half of weekly',
          'scoring and a bonus LOSS to the bottom half, so a team can go 2-0 or 0-2 in a week.',
          'In that case: compute the league median score for the week, list which teams earned the',
          'bonus win and which took the bonus loss, flag anyone who went 2-0 or 0-2, and explicitly',
          'note any team that lost head-to-head but still salvaged a top-half win (or won but took a',
          'bottom-half loss). Make sure all records in the tables reflect both games.',
          'If median_scoring is FALSE, state in one line that this league does NOT use top-half',
          'bonus wins and skip the rest of this section. Do not assume either way.',

          '\n\nSECTION 5 — Power rankings table, sorted best to worst by current power ranking.',
          'Columns: Rank, Change (movement versus last week\'s power ranking, e.g. +2 / -1 / —),',
          'Team, Record, This Week\'s Score, PF (season), PA (season), Trend.',
          'The Trend column is a short blurb (roughly 10-15 words) on direction of travel: hot,',
          'cooling, overachieving their points, unlucky, fading, etc. Ground it in the numbers —',
          'compare record against PF, and this week\'s score against their season average.',

          '\n\nSECTION 6 — Next week\'s matchups table. Columns: Matchup, Projected Score, Projected',
          'Winner, Win Confidence (lock / lean / coin flip), and the swing player to watch.',
          'State the date and week the projections were generated as of, and warn that injuries and',
          'inactives will move these numbers. Finish with the one game of the week and why.',

          '\n\nClose with a short sign-off line in the chosen tone "See you next week".',
          'Keep tables clean Markdown so the email renders anywhere.',
          'If any tool call fails or data is missing, say so in that section',
          'rather than filling the gap with guesses.'
        ]
          .filter(Boolean)
          .join(' ')
      )
  );

  server.registerPrompt(
    'power-rankings-writeup',
    {
      title: 'Power rankings writeup',
      description: 'Turn the computed power rankings into commentary.',
      argsSchema: z.object({
        week: optionalString('Week to rank through. Defaults to the current week.')
      })
    },
    ({ week }) =>
      withRules(
        [
          `Write power rankings commentary${week ? ` through week ${week}` : ''}.`,
          'Use get_power_rankings, get_standings and get_teams.',
          'For each team give the rank, the movement implied against their record, one strength,',
          'one weakness, and a one-line verdict. Explicitly call out teams whose record is running',
          'ahead of or behind their points scored.'
        ].join(' ')
      )
  );

  server.registerPrompt(
    'playoff-outlook',
    {
      title: 'Playoff outlook',
      description: 'Assess playoff chances and what has to happen.',
      argsSchema: z.object({
        team: optionalString('Team name or id. Omit for a league-wide picture.')
      })
    },
    ({ team }) =>
      withRules(
        [
          `Assess the playoff picture${team ? ` for team "${team}"` : ' for the whole league'}.`,
          'Read the playoff team count and the final regular-season week from get_settings, then use',
          'get_standings, get_teams and get_matchups for remaining games.',
          'Identify who is already in, who is on the bubble, who is eliminated, and the specific',
          'results the target team needs. Note relevant tiebreakers such as points for.'
        ].join(' ')
      )
  );

  server.registerPrompt(
    'roster-checkup',
    {
      title: 'Roster checkup',
      description: 'Audit a roster for holes, bye-week gaps and dead weight.',
      argsSchema: z.object({
        team: z.string().describe('Team name or id to audit.'),
        week: optionalString('Week to audit from. Defaults to the current week.')
      })
    },
    ({ team, week }) =>
      withRules(
        [
          `Audit the roster for team "${team}"${week ? ` starting from week ${week}` : ''}.`,
          TEAM_HINT,
          'Use get_roster, get_settings and get_free_agents.',
          'Report: positional strengths and weaknesses versus the required lineup slots, upcoming',
          'bye-week crunches, injured or unstartable players occupying bench spots, obvious drop',
          'candidates, and the single highest-impact move available right now.'
        ].join(' ')
      )
  );

  server.registerPrompt(
    'draft-review',
    {
      title: 'Draft review',
      description: 'Grade the draft in hindsight.',
      argsSchema: z.object({
        team: optionalString('Team name or id to focus on. Omit to review the whole league.')
      })
    },
    ({ team }) =>
      withRules(
        [
          `Review the draft${team ? ` for team "${team}"` : ' for the whole league'} with hindsight.`,
          'Use get_draft, get_teams and get_standings.',
          'Identify the biggest steals and busts by round, which manager drafted best, and how much',
          'of the current standings can be traced back to the draft versus in-season management.'
        ].join(' ')
      )
  );

  server.registerPrompt(
    'league-briefing',
    {
      title: 'League briefing',
      description: 'Catch me up on everything happening in the league.',
      argsSchema: z.object({
        team: optionalString('Team name or id to center the briefing on.')
      })
    },
    ({ team }) =>
      withRules(
        [
          `Give a full briefing on the league${team ? `, centered on team "${team}"` : ''}.`,
          'Start with get_league_profile, then get_standings, get_power_rankings, get_activity and the',
          'most recent get_scoreboard.',
          'Summarize: where the season stands, the current contenders and pretenders, notable recent',
          'moves, and the two or three decisions that matter most this week.'
        ].join(' ')
      )
  );

  server.registerPrompt(
    'explain-my-league',
    {
      title: 'Explain my league settings',
      description: 'Translate the league rules into plain English and what they mean for strategy.',
      argsSchema: z.object({})
    },
    () =>
      withRules(
        [
          'Explain this league to someone who has never played fantasy football.',
          'Call get_league_profile and walk through it in plain English: how scoring works and what it',
          'rewards, exactly which positions must be started each week (calling out how many FLEX spots',
          'there are and what can fill them, and whether it is superflex), how many bench and IR spots',
          'exist, how waivers and FAAB work, when the trade deadline is, and how the playoffs are',
          'structured.',
          'Then give the three most important strategic consequences of these specific rules.',
          'Avoid jargon; when you must use a term, define it in the same sentence.'
        ].join(' ')
      )
  );

  server.registerPrompt(
    'lineup-legality-check',
    {
      title: 'Check my lineup',
      description: 'Verify a lineup is legal, full and optimal before kickoff.',
      argsSchema: z.object({
        team: z.string().describe('Team name or id to check.'),
        week: optionalString('Week to check. Defaults to the current week.')
      })
    },
    ({ team, week }) =>
      withRules(
        [
          `Check the lineup for team "${team}"${week ? ` in week ${week}` : ' this week'}.`,
          TEAM_HINT,
          'Call check_lineup. Report findings grouped by severity: errors first (empty starting slots,',
          'players on bye, OUT or DOUBTFUL starters, anyone illegally occupying an IR slot), then',
          'warnings (questionable starters, bench players outscoring starters), then informational',
          'items (available IR stashes).',
          'For any close start/sit call, confirm with get_box_scores includeLineup=true, since',
          'check_lineup compares season averages rather than this week\'s projection.',
          'End with a specific, ordered list of moves to make before kickoff. If the lineup is clean,',
          'say so plainly instead of inventing problems.'
        ].join(' ')
      )
  );

  server.registerPrompt(
    'ir-and-bench-optimization',
    {
      title: 'IR and bench optimization',
      description: 'Free up roster spots using IR slots and drop candidates.',
      argsSchema: z.object({
        team: z.string().describe('Team name or id to optimize.'),
        week: optionalString('Week to evaluate. Defaults to the current week.')
      })
    },
    ({ team, week }) =>
      withRules(
        [
          `Optimize roster spots for team "${team}"${week ? ` in week ${week}` : ''}.`,
          TEAM_HINT,
          'Use get_league_profile for the IR and bench slot counts, then check_lineup and get_roster.',
          'Identify: injured players eligible to move to IR (only OUT and INJURY_RESERVE qualify),',
          'healthy players illegally parked on IR, bench players who are unstartable dead weight, and',
          'what the freed spots should be spent on from get_free_agents.',
          'If the league has zero IR slots, say so and focus on drop candidates instead.'
        ].join(' ')
      )
  );

  server.registerPrompt(
    'scoring-quirks',
    {
      title: 'Scoring quirks',
      description: 'What this league rewards that most managers overlook.',
      argsSchema: z.object({})
    },
    () =>
      withRules(
        [
          'Identify what this league\'s scoring rewards that a manager used to default settings would',
          'overlook.',
          'Call get_league_profile and study the scoring breakdown and strategic implications.',
          'Call out every deviation from the common defaults (1 point per 10 yards, 4-point passing',
          'TDs, -2 interceptions, no yardage bonuses, standard single FLEX) and explain concretely',
          'which player archetypes each deviation helps or hurts.',
          'If any scoring rules came back unlabeled, say which stat IDs could not be interpreted',
          'rather than guessing at them.'
        ].join(' ')
      )
  );

  server.registerPrompt(
    'format-adjusted-rankings',
    {
      title: 'Format-adjusted rankings',
      description: 'Rank players for this league\'s specific rules, not generic rankings.',
      argsSchema: z.object({
        position: optionalString('Position to rank, e.g. RB, WR, TE, QB.'),
        pool: optionalString('What to rank: "free agents", a team name, or "league".')
      })
    },
    ({ position, pool }) =>
      withRules(
        [
          `Rank ${position || 'players'} from ${pool || 'the free agent pool'} for THIS league's rules.`,
          'Start with get_league_profile so the ranking reflects the real scoring and lineup slots,',
          'then pull the player pool with get_free_agents or get_roster.',
          'Explicitly adjust for format: superflex inflates QBs; full PPR inflates high-reception',
          'players; standard scoring inflates goal-line backs; multiple FLEX slots raise the value of',
          'RB/WR depth; yardage bonuses reward high-ceiling boom players.',
          'Explain, for at least the top three, how this league\'s rules move them relative to a',
          'generic ranking list.'
        ].join(' ')
      )
  );
}
