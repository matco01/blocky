import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { CHAIN } from '@blocky/shared';
import {
  createChainReader,
  fetchGatewayBalances,
  getChain,
  rpcConfigFromEnv,
} from '@blocky/wallet-core';
import { fetchExplorerTransfers } from './activity';
import { createAgentHandler } from './agent';
import { createApp } from './app';
import { createPrivyIdentity } from './auth';
import { openDatabase } from './db/client';
import { loadEnv } from './env';
import { createStore } from './store';

const env = loadEnv();

// Embedded Postgres persists to `.data/` at the repo root unless a real
// DATABASE_URL is set. `.data/` is gitignored.
const database = await openDatabase(
  env.DATABASE_URL
    ? { url: env.DATABASE_URL }
    : { dataDir: fileURLToPath(new URL('../../../.data/pglite', import.meta.url)) },
);

const store = createStore(database.db);
const reader = createChainReader(rpcConfigFromEnv(env));
const arc = getChain(CHAIN.arcTestnet);

const app = createApp({
  store,
  reader,
  identity: createPrivyIdentity({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET }),
  agent: env.ANTHROPIC_API_KEY ? createAgentHandler(store, env.ANTHROPIC_API_KEY, reader) : null,
  gatewayBalances: (address) => fetchGatewayBalances(address, { testnet: true }),
  explorerTransfers: (address) =>
    fetchExplorerTransfers(address, { apiBase: `${arc.explorerUrl}/api/v2`, token: arc.usdc }),
  logRequests: true,
});

const server = serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
  console.log(`blocky api on http://localhost:${port} (${env.NODE_ENV}, database: ${database.kind})`);
});

async function shutdown() {
  server.close();
  await database.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
