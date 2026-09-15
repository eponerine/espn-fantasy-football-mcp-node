import { registerAnalysisTools } from './analysis-tools.js';
import { registerKnowledgeTools } from './knowledge-tools.js';
import { registerLeagueTools } from './league-tools.js';
import { registerMatchupTools } from './matchup-tools.js';
import { registerPlayerTools } from './player-tools.js';
import { registerTransactionTools } from './transaction-tools.js';

export function registerAllTools(server, client) {
  registerLeagueTools(server, client);
  registerMatchupTools(server, client);
  registerPlayerTools(server, client);
  registerTransactionTools(server, client);
  registerAnalysisTools(server, client);
  registerKnowledgeTools(server);
}
