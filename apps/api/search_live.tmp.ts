import './src/env';
import { loadEnv } from './src/env';
import Anthropic from '@anthropic-ai/sdk';
import { runAgentTurn, estimateCostUsd } from '@blocky/agent';
import { fetchMarketOverview } from '@blocky/wallet-core';

const env = loadEnv();
const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY! });
const none = async () => ({});
const tools = { getBalance: none, getPolicy: none, getSupportedChains: none, listContacts: none, getTokenPrice: none, resolveAddress: none, saveContact: none as any, deleteContact: none, getRecentActivity: none, getArcEcosystem: none, getMarketOverview: () => fetchMarketOverview() };

for (const q of ["How's the crypto market doing today?", "What's the latest news about Arc, Circle's blockchain?"]) {
  const turn = await runAgentTurn(q, { client, tools, webSearch: true });
  console.log('\nQ:', q, '\nkind:', turn.kind, '| searches:', turn.usage.webSearches, '| steps:', turn.usage.steps, '| cost $' + estimateCostUsd(turn.usage).toFixed(4));
  console.log('A:', turn.text);
}
