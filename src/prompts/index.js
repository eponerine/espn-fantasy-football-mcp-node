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
          'pickup of the week, and how the playoff picture shifted.',
          'Use real numbers from the tools. Do not invent NFL news.'
        ].join(' ')
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
