// First, before anything else is evaluated: this loads `.env`, and the shared
// packages read the network switch from the environment as they load.
import { loadEnv } from './env';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import {
  DEFAULT_CHAIN,
  IS_TESTNET,
  NETWORK,
  createChainReader,
  fetchGatewayBalances,
  fetchWalletHoldings,
  getTokenPriceUsd,
  priceAsDecimal,
  readUsdcBalance,
  forgetWalletHoldings,
  getChain,
  rpcConfigFromEnv,
  usdcAddress,
} from '@blocky/wallet-core';
import { fetchExplorerTransfers } from './activity';
import { ALERT_CHECK_MS, checkPriceAlerts } from './alerts';
import { AUTOSAVE_CHECK_MS, CHECK_IN_SCAN_MS, runAutoSave, runCheckIns } from './autosave';
import { createAgentHandler } from './agent';
import { createApp } from './app';
import { createPrivyIdentity } from './auth';
import { openDatabase } from './db/client';
import { createStore } from './store';

const env = loadEnv();

// The shared packages chose their network when they loaded. If that is not
// what the environment says, something read the switch too early — stop
// rather than serve one network while believing it is the other.
if (env.BLOCKY_NETWORK !== NETWORK) {
  throw new Error(`Network mismatch: BLOCKY_NETWORK is ${env.BLOCKY_NETWORK} but the chain registry loaded as ${NETWORK}.`);
}

// Embedded Postgres persists to `.data/` at the repo root unless a real
// DATABASE_URL is set. `.data/` is gitignored.
const database = await openDatabase(
  env.DATABASE_URL
    ? { url: env.DATABASE_URL }
    : { dataDir: fileURLToPath(new URL('../../../.data/pglite', import.meta.url)) },
);

const store = createStore(database.db);
const reader = createChainReader(rpcConfigFromEnv(env));
const home = getChain(DEFAULT_CHAIN);

/*
 * Testnet reads ArcScan directly. Arc's mainnet explorer turns away server
 * requests, so mainnet goes through Blockscout's hosted API — which needs a
 * key; without one the feed falls back to Blocky's own sends and says so.
 */
const explorerTransfers = (address: Parameters<typeof fetchExplorerTransfers>[0]) =>
  IS_TESTNET
    ? fetchExplorerTransfers(address, { apiBase: `${home.explorerUrl}/api/v2`, token: usdcAddress(home.id) })
    : env.BLOCKSCOUT_API_KEY
      ? fetchExplorerTransfers(address, {
          apiBase: `https://api.blockscout.com/${home.id}/api/v2`,
          token: usdcAddress(home.id),
          apiKey: env.BLOCKSCOUT_API_KEY,
        })
      : Promise.reject(new Error('No BLOCKSCOUT_API_KEY configured for mainnet activity.'));

/*
 * For `/health`: enough to tell from outside whether a deploy is the commit
 * we pushed and whether each chain reads through our provider or a
 * rate-limited public endpoint. Names only — never a URL, which carries a key.
 */
const providerUrls: Record<string, string | undefined> = IS_TESTNET
  ? { 'Arc Testnet': env.ARC_TESTNET_RPC_URL, 'Base Sepolia': env.BASE_SEPOLIA_RPC_URL, 'Arbitrum Sepolia': env.ARBITRUM_SEPOLIA_RPC_URL }
  : {
      Arc: env.ARC_RPC_URL,
      Ethereum: env.ETHEREUM_RPC_URL,
      Base: env.BASE_RPC_URL,
      Arbitrum: env.ARBITRUM_RPC_URL,
      Optimism: env.OPTIMISM_RPC_URL,
      Polygon: env.POLYGON_RPC_URL,
      Unichain: env.UNICHAIN_RPC_URL,
      Avalanche: env.AVALANCHE_RPC_URL,
      HyperEVM: env.HYPEREVM_RPC_URL,
      Robinhood: env.ROBINHOOD_RPC_URL,
    };
const health = {
  commit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
  rpc: Object.fromEntries(Object.entries(providerUrls).map(([chain, url]) => [chain, url ? 'provider' : 'public'])),
  activityFeed: IS_TESTNET || env.BLOCKSCOUT_API_KEY ? 'complete' : 'blocky-sends-only',
};

// Blocky's fee on swaps and moves out of Arc. No address configured, no fee.
const blockyFee = env.BLOCKY_FEE_RECIPIENT ? { recipient: env.BLOCKY_FEE_RECIPIENT, bps: env.BLOCKY_FEE_BPS } : null;

const app = createApp({
  store,
  reader,
  identity: createPrivyIdentity({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET }),
  agent: env.ANTHROPIC_API_KEY
    ? createAgentHandler(store, env.ANTHROPIC_API_KEY, reader, explorerTransfers, blockyFee)
    : null,
  gatewayBalances: (address) => fetchGatewayBalances(address, { testnet: IS_TESTNET }),
  walletHoldings: (address, tracked) => fetchWalletHoldings(reader, address, fetch, tracked),
  forgetHoldings: (address) => forgetWalletHoldings(address),
  explorerTransfers,
  logRequests: true,
  blockyFee,
  health,
});

// Price alerts: one sweep a minute against the shared price snapshot.
const alertTimer = setInterval(() => {
  void checkPriceAlerts(store, async (symbol) => priceAsDecimal(await getTokenPriceUsd(symbol))).catch((error: unknown) =>
    console.error('price alerts failed', error),
  );
}, ALERT_CHECK_MS);
alertTimer.unref();

// Auto-save rules fill pots on their own; the weekly check-in lands in the inbox.
const autoSaveTimer = setInterval(() => {
  void runAutoSave(store, async (address) => (await readUsdcBalance(reader, DEFAULT_CHAIN, address)).amount).catch(
    (error: unknown) => console.error('auto-save failed', error),
  );
}, AUTOSAVE_CHECK_MS);
autoSaveTimer.unref();

const checkInTimer = setInterval(() => {
  void runCheckIns(store).catch((error: unknown) => console.error('check-ins failed', error));
}, CHECK_IN_SCAN_MS);
checkInTimer.unref();

const server = serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
  console.log(
    `blocky api on http://localhost:${port} (${env.NODE_ENV}, ${NETWORK}: ${home.name}, database: ${database.kind})`,
  );
});

async function shutdown() {
  server.close();
  await database.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
