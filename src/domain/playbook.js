/**
 * Maps the questions real fantasy managers ask to the tool calls that answer them.
 * Exposed as an MCP resource and a tool so a model can orient itself before guessing.
 */

export const ANSWERING_RULES = `# How to answer fantasy questions with this server

1. **Start with \`get_league_profile\`.** It fuses league summary and settings into plain English:
   current week, scoring format, the exact starting lineup (how many FLEX slots, superflex or not),
   bench and IR counts, waiver/FAAB mechanics, playoff structure, and the strategic implications
   those rules create. Nearly every good answer depends on it. \`get_settings\` still returns the
   raw payload if you need a field the profile omits.
2. **Never assume a standard league.** Two FLEX spots, superflex, 6-point passing TDs or full PPR
   each change player value dramatically. The profile tells you which apply.
3. **Map names to IDs.** \`get_teams\` gives \`team_id\` -> \`team_name\`. Users say "my team" or a
   nickname; resolve it to a numeric \`teamId\` before calling roster tools.
4. **Never request a future week for results.** \`get_box_scores\` returns HTTP 400 for weeks beyond
   \`current_week\`. For upcoming games use \`get_matchups\` or \`get_scoreboard\`.
5. **Use \`check_lineup\` before giving start/sit advice.** It catches empty slots, bye-week and OUT
   starters, illegal IR occupancy and bench players outscoring starters, all against the league's
   real slot rules.
6. **Know which projection you are holding.** On a roster, \`projected_points\` and \`total_points\`
   are *season* figures; \`avg_points\` and \`projected_avg_points\` are per game. Only
   \`get_box_scores\` with \`includeLineup: true\` gives a true weekly projection.
7. **Do not trust \`active_status\` for availability.** It initializes to \`'bye'\` and only resolves
   once real stats exist, so every player looks benched before kickoff. Use \`on_bye_week\` and
   \`injury_status\` instead.
8. **Separate skill from luck.** Compare points_for to record; a team with top-2 points and a losing
   record is unlucky, not bad. Mention it, managers love hearing it.
9. **State your uncertainty.** This API reports league data, not injury news, weather or expert
   projections beyond ESPN's own. Do not invent news.`;

export const QUESTION_PLAYBOOK = [
  {
    question: 'Who should I start this week? / start-sit',
    tools: ['get_league_profile', 'check_lineup', 'get_roster', 'get_box_scores'],
    approach:
      'Run check_lineup first — it flags empty slots, bye-week and OUT starters, and bench players ' +
      'outscoring starters against the real slot rules. Then pull get_box_scores with ' +
      'includeLineup=true for true weekly projections on the close calls. Weight the scoring format ' +
      'from get_league_profile: in PPR, favor high-reception players.'
  },
  {
    question: 'What kind of league is this? / explain my settings',
    tools: ['get_league_profile'],
    approach:
      'One call covers it. Translate the scoring format, FLEX and IR slots, waiver mechanics and ' +
      'playoff structure into plain English, then lead with the strategic implications.'
  },
  {
    question: 'Is my lineup set? / did I miss anything?',
    tools: ['check_lineup'],
    approach:
      'check_lineup returns severity-ranked issues. Report errors (empty slots, bye/OUT starters, ' +
      'illegal IR) before warnings (questionable starters, bench upgrades) and info (IR stashes).'
  },
  {
    question: 'Who should I pick up off waivers?',
    tools: ['get_free_agents', 'get_settings', 'get_roster', 'get_transactions'],
    approach:
      'Fetch free agents filtered by the position of need, sort by projected_points and ' +
      'recent points, then cross-reference the asking team roster to find a droppable player. ' +
      'Use get_transactions to see whether rivals are already bidding on the same names.'
  },
  {
    question: 'Is this trade fair? / should I accept?',
    tools: ['get_league_profile', 'get_teams', 'get_roster', 'get_standings'],
    approach:
      'Compare both rosters slot by slot against the real starting lineup from get_league_profile. ' +
      'Judge the trade by starting-lineup improvement, not raw player count — 2-for-1 trades favor ' +
      'the side receiving the best player. In superflex, QBs carry far more value. Factor positional ' +
      'scarcity, bye-week overlap and each team\'s playoff position.'
  },
  {
    question: 'How is my team actually doing?',
    tools: ['get_standings', 'get_power_rankings', 'get_teams'],
    approach:
      'Report record and rank, then contrast with points_for/points_against and power ' +
      'rankings to separate quality from luck.'
  },
  {
    question: 'Can I still make the playoffs?',
    tools: ['get_settings', 'get_standings', 'get_matchups', 'get_teams'],
    approach:
      'Read playoff team count and final regular-season week from settings, count remaining ' +
      'games, then identify which teams the user must pass and their remaining matchups.'
  },
  {
    question: 'Recap the week / write a league newsletter',
    tools: ['get_scoreboard', 'get_box_scores', 'get_power_rankings', 'get_activity'],
    approach:
      'Highlight the highest and lowest scores, closest margin, biggest bench blunder ' +
      '(bench player who outscored a starter), and notable roster moves from activity.'
  },
  {
    question: 'How did my draft go?',
    tools: ['get_draft', 'get_teams', 'get_standings'],
    approach:
      'Compare each pick\'s round to the drafting team\'s current standing and points. ' +
      'Call out steals and busts by round.'
  },
  {
    question: 'What is going on in the league lately?',
    tools: ['get_activity', 'get_transactions'],
    approach:
      'Summarize adds, drops, waiver bids and trades in chronological order, grouped by team.'
  },
  {
    question: 'Tell me about a specific player',
    tools: ['get_player_info', 'get_free_agents'],
    approach:
      'get_player_info accepts a playerId or a name. Report position, pro team, ownership ' +
      'percentages, injury status and recent/projected scoring.'
  },
  {
    question: 'Who is the best/worst manager, who got lucky?',
    tools: ['get_standings', 'get_teams', 'get_box_scores', 'get_power_rankings'],
    approach:
      'Combine record, points_for, points_against and weekly box scores. Compute an ' +
      'all-play record across weeks if enough box scores are available.'
  }
];

export const PLAYBOOK_MARKDOWN = [
  ANSWERING_RULES,
  '# Common questions and the tools that answer them',
  ...QUESTION_PLAYBOOK.map(
    (entry) => `## ${entry.question}\n\n- Tools: ${entry.tools.join(', ')}\n- Approach: ${entry.approach}`
  )
].join('\n\n');
