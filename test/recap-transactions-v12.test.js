import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeTransactions } from '../recap/transactions.js';

const claim = (team_id, bid_amount, status, extra = {}) => ({
  team_id, bid_amount, status, type: 'WAIVER', date: 10000, scoring_period: 7,
  items: [{ type: 'ADD', playerId: 4586312, player: 'Jaylin Noel' },
    { type: 'DROP', playerId: 99, player: 'Earlier drop' }], ...extra
});
const summarize = (transactions) => summarizeTransactions({ transactions,
  teams: [{ team_id: 1, name: 'One' }, { team_id: 9, name: 'Nine' }],
  playersByTeam: new Map(), week: 7 }).teams[0].failed_bids[0];

test('A1 winning claim takes precedence over an earlier dropped player', () => {
  const rows = [claim(1, 0, 'EXECUTED', { date: 9000, type: 'FREEAGENT' }),
    claim(1, 3, 'FAILED_PLAYERALREADYDROPPED'), claim(9, 3, 'EXECUTED')];
  assert.equal(summarize(rows).outcome, 'tiebreak_lost');
  rows[2].bid_amount = 4;
  assert.equal(summarize(rows).outcome, 'outbid');
  assert.equal(summarize(rows.slice(0, 2)).outcome, 'drop_player_already_dropped');
  assert.equal(summarize([claim(1, 3, 'FAILED_PLAYERALREADYDROPPED')]).outcome, 'player_already_dropped');
  assert.equal(summarize([claim(1, 3, 'FAILED_ROSTERLIMIT')]).outcome, 'unknown');
  assert.equal(summarize([claim(1, 3, 'FAILED_PLAYERALREADYDROPPED'),
    claim(9, 3, 'EXECUTED', { date: 12000 })]).outcome, 'player_already_dropped');
});

test('A2 failed bids carry winner identity and amount or explicit nulls', () => {
  const failed = summarize([claim(1, 3, 'FAILED_PLAYERALREADYDROPPED'), claim(9, 3, 'EXECUTED')]);
  assert.deepEqual([failed.winner, failed.winner_team_id, failed.winning_bid], ['Nine', 9, 3]);
  const unmatched = summarize([claim(1, 3, 'FAILED_PLAYERALREADYDROPPED')]);
  assert.deepEqual([unmatched.winner, unmatched.winner_team_id, unmatched.winning_bid], [null, null, null]);
});