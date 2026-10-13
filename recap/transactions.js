import { fromCents, toCents } from './numbers.js';

function addedItem(transaction) {
  return transaction.items?.find((item) => item.type === 'ADD') ?? null;
}

function droppedItem(transaction) {
  return transaction.items?.find((item) => item.type === 'DROP') ?? null;
}

export function dedupeTransactions(transactions = []) {
  const preferredStatus = { EXECUTED: 4, FAILED_INVALIDPLAYERSOURCE: 3, FAILED_ROSTERLIMIT: 3, CANCELED: 2, PENDING: 1 };
  const rowsByKey = new Map();
  for (const transaction of transactions) {
    const added = addedItem(transaction);
    const key = [transaction.team_id, added?.playerId ?? added?.player, transaction.bid_amount ?? 0, transaction.type].join('|');
    const current = rowsByKey.get(key);
    const rank = preferredStatus[transaction.status] ?? 0;
    const currentRank = preferredStatus[current?.status] ?? -1;
    if (!current || rank > currentRank || (rank === currentRank && Number(transaction.date) > Number(current.date))) {
      rowsByKey.set(key, transaction);
    }
  }
  return [...rowsByKey.values()];
}

export function summarizeTransactions({ transactions, teams, playersByTeam, week }) {
  const clean = dedupeTransactions(transactions);
  const teamById = new Map(teams.map((team) => [team.team_id, team]));
  const summaries = new Map(teams.map((team) => [team.team_id, {
    team_id: team.team_id,
    team: team.team_name ?? team.name,
    executed_claims: [],
    failed_bids: [],
    free_agent_adds: [],
    drops: [],
    faab_spent: 0,
    faab_bid: 0,
    faab_lost: 0
  }]));

  for (const transaction of clean) {
    const summary = summaries.get(transaction.team_id);
    if (!summary) continue;
    const bid = Math.max(0, Number(transaction.bid_amount) || 0);
    const add = addedItem(transaction);
    const drop = droppedItem(transaction);
    summary.faab_bid += bid;
    if (transaction.status === 'EXECUTED') {
      summary.faab_spent += bid;
      if (drop) summary.drops.push({ player_id: drop.playerId, player: drop.player });
      if (add) {
        const player = (playersByTeam.get(transaction.team_id) ?? []).find((entry) => entry.player_id === add.playerId);
        const started = player ? !['BE', 'IR'].includes(player.lineup_slot ?? player.slot_position) : null;
        const claim = {
          player_id: add.playerId,
          player: add.player,
          bid,
          dropped_player: drop?.player ?? null,
          week_points: player?.points == null ? null : Number(player.points),
          lineup_status: started == null ? null : started ? 'started' : 'sat',
          prior_week_points: null,
          transaction_type: transaction.type
        };
        summary.executed_claims.push(claim);
        if (transaction.type === 'FREEAGENT') summary.free_agent_adds.push({ player_id: add.playerId, player: add.player });
      }
    } else if (String(transaction.status).startsWith('FAILED')) {
      summary.faab_lost += bid;
      if (add) summary.failed_bids.push({
        player_id: add.playerId,
        player: add.player,
        bid,
        reason: transaction.status,
        winner: null
      });
    }
  }

  const wars = new Map();
  for (const transaction of clean) {
    const add = addedItem(transaction);
    if (!add || transaction.type !== 'WAIVER') continue;
    const processingSecond = Number.isFinite(Number(transaction.date)) ? Math.floor(Number(transaction.date) / 1000) : '';
    const key = `${transaction.scoring_period ?? week}:${processingSecond}:${add.playerId}`;
    if (!wars.has(key)) wars.set(key, { player_id: add.playerId, player: add.player, bids: [] });
    wars.get(key).bids.push({
      team_id: transaction.team_id,
      team: teamById.get(transaction.team_id)?.team_name ?? teamById.get(transaction.team_id)?.name ?? null,
      bid: Number(transaction.bid_amount) || 0,
      status: transaction.status
    });
  }
  const biddingWars = [];
  for (const war of wars.values()) {
    if (war.bids.length < 2) continue;
    const winnerBid = war.bids.find((bid) => bid.status === 'EXECUTED') ?? null;
    const winnerPlayer = winnerBid
      ? (playersByTeam.get(winnerBid.team_id) ?? []).find((player) => player.player_id === war.player_id)
      : null;
    biddingWars.push({
      player_id: war.player_id,
      player: war.player,
      bids: war.bids,
      winner: winnerBid?.team ?? null,
      winner_team_id: winnerBid?.team_id ?? null,
      winning_bid: winnerBid?.bid ?? null,
      total_bids: war.bids.reduce((total, bid) => total + bid.bid, 0),
      winner_points: winnerPlayer?.points == null ? null : Number(winnerPlayer.points)
    });
  }
  for (const summary of summaries.values()) {
    for (const failed of summary.failed_bids) {
      const war = biddingWars.find((entry) => entry.player_id === failed.player_id);
      failed.winner = war?.winner ?? null;
    }
    summary.faab_spent = fromCents(toCents(summary.faab_spent));
    summary.faab_bid = fromCents(toCents(summary.faab_bid));
    summary.faab_lost = fromCents(toCents(summary.faab_lost));
  }
  const teamsWithMoves = [...summaries.values()];
  const leagueTotal = teamsWithMoves.reduce((sum, team) => sum + toCents(team.faab_spent), 0);
  return {
    teams: teamsWithMoves,
    bidding_wars: biddingWars,
    league_faab_total: fromCents(leagueTotal),
    top_spender: [...teamsWithMoves].sort((left, right) => right.faab_spent - left.faab_spent)[0] ?? null
  };
}