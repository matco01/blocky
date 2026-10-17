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
} from '@blocky/wallet-core';
import type { Address } from '@blocky/shared';
import { ALERT_CHECK_MS, checkPriceAlerts } from './alerts';
import { AUTOSAVE_CHECK_MS, CHECK_IN_SCAN_MS, runAutoSave, runCheckIns } from './autosave';
import { createAgentHandler } from './agent';
import { createApp } from './app';
import { createPrivyIdentity } from './auth';
import { openDatabase } from './db/client';
import { RECEIPT_CHECK_MS, createExpoPush, withPush } from './push';
import { createStore } from './store';
import { WATCH_MS, readAllHistory, walletTransfers, watchTransfers } from './watcher';

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

const records = createStore(database.db);
// Everything that tells a user something goes through `notify`; wrapped, it
// also reaches their phone.
const push = createExpoPush({ store: records, accessToken: env.EXPO_ACCESS_TOKEN });
const store = withPush(records, push);
const reader = createChainReader(rpcConfigFromEnv(env));
const home = getChain(DEFAULT_CHAIN);

/*
 * For `/health`: enough to tell from outside whether a deploy is the commit
 * we pushed, whether each chain reads through our provider or a rate-limited
 * public endpoint, and how far the chain watcher has read. Names only — never
 * a URL, which carries a key.
 */
const providerUrls: Record<string, string | undefined> = IS_TESTNET
  ? // Testnet URLs default to the public endpoints, so only a set variable means ours.
    {
      'Arc Testnet': process.env.ARC_TESTNET_RPC_URL,
      'Base Sepolia': process.env.BASE_SEPOLIA_RPC_URL,
      'Arbitrum Sepolia': process.env.ARBITRUM_SEPOLIA_RPC_URL,
    }
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
const deploy = {
  commit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
  rpc: Object.fromEntries(Object.entries(providerUrls).map(([chain, url]) => [chain, url ? 'provider' : 'public'])),
};

async function health() {
  const cursor = await records.getChainCursor(DEFAULT_CHAIN).catch(() => null);
  return {
    ...deploy,
    chainWatcher: cursor
      ? {
          readTo: cursor.block,
          readAt: cursor.updatedAt.toISOString(),
          historyBlocksLeft: Math.max(0, cursor.historyTo - cursor.historyNext + 1),
        }
      : null,
  };
}

// Blocky's fee on swaps and moves out of Arc. No address configured, no fee.
const blockyFee = env.BLOCKY_FEE_RECIPIENT ? { recipient: env.BLOCKY_FEE_RECIPIENT, bps: env.BLOCKY_FEE_BPS } : null;

// The activity feed's on-chain half: what the chain watcher has read.
const transfersOf = (address: Address) => walletTransfers(records, DEFAULT_CHAIN, address);

const app = createApp({
  store,
  reader,
  identity: createPrivyIdentity({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET }),
  agent: env.ANTHROPIC_API_KEY
    ? createAgentHandler(store, env.ANTHROPIC_API_KEY, reader, transfersOf, blockyFee)
    : null,
  gatewayBalances: (address) => fetchGatewayBalances(address, { testnet: IS_TESTNET }),
  walletHoldings: (address, tracked) => fetchWalletHoldings(reader, address, fetch, tracked),
  forgetHoldings: (address) => forgetWalletHoldings(address),
  walletTransfers: transfersOf,
  logRequests: true,
  blockyFee,
  health,
});

/*
 * The jobs Blocky runs on his own. Each waits for its last run to finish
 * before starting the next: a slow price feed or RPC must not stack runs on
 * top of each other, where two auto-saves would count one deposit twice and
 * two alert sweeps would send one alert twice.
 *
 * They assume one API instance — see "Running more than one API instance" in
 * docs/ENGINEERING.md before scaling out.
 */
function every(ms: number, name: string, job: () => Promise<unknown>): void {
  let running = false;
  const failed = quietLog(name);
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    job()
      .catch(failed)
      .finally(() => {
        running = false;
      });
  }, ms);
  timer.unref();
}

/**
 * A job's failures, for the log — at most one line a minute, with a count of
 * the rest. The chain watcher runs every few seconds; an endpoint that
 * rate-limits it for a minute shouldn't write fifteen identical lines.
 */
function quietLog(name: string): (error: unknown) => void {
  let loggedAt = 0;
  let quiet = 0;
  return (error) => {
    const now = Date.now();
    if (now - loggedAt < 60_000) {
      quiet++;
      return;
    }
    console.error(`${name} failed${quiet ? ` (and ${quiet} more times since the last report)` : ''}:`, describeError(error));
    loggedAt = now;
    quiet = 0;
  };
}

/**
 * An error, for the log. Not viem's full message: that carries the endpoint
 * URL — and a provider's URL carries its key — and the request body. Its
 * short message and the node's own words say what went wrong.
 */
function describeError(error: unknown): unknown {
  const { shortMessage, details } = (error ?? {}) as { shortMessage?: unknown; details?: unknown };
  if (typeof shortMessage !== 'string') return error;
  return typeof details === 'string' && details ? `${shortMessage} — ${details}` : shortMessage;
}

/** Quotes nobody used are kept this long after they run out — long enough for any old chat card to explain itself. */
const PLAN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PLAN_PRUNE_MS = 6 * 60 * 60 * 1000;

// The chain watcher: money in and out of Blocky wallets, read off Arc as it
// lands — the recipient told within seconds, app open or not.
every(WATCH_MS, 'chain watcher', () => watchTransfers({ store, reader, chainId: DEFAULT_CHAIN }));
// And, once, everything before the watcher's first start. It finishes, then stops.
const historyFailed = quietLog('chain history');
void readAllHistory({ store, reader, chainId: DEFAULT_CHAIN }, { onError: historyFailed }).catch(historyFailed);

// Price alerts: one sweep a minute against the shared price snapshot.
every(ALERT_CHECK_MS, 'price alerts', () =>
  checkPriceAlerts(store, async (symbol) => priceAsDecimal(await getTokenPriceUsd(symbol))),
);

// Auto-save rules fill pots on their own; the weekly check-in lands in the inbox.
every(AUTOSAVE_CHECK_MS, 'auto-save', () =>
  runAutoSave(store, async (address) => (await readUsdcBalance(reader, DEFAULT_CHAIN, address)).amount),
);
every(CHECK_IN_SCAN_MS, 'check-ins', () => runCheckIns(store));

// Every proposal and re-quote stores a plan; the ones never used are cleared out.
every(PLAN_PRUNE_MS, 'plan pruning', () => store.pruneStalePlans(new Date(Date.now() - PLAN_RETENTION_MS)));

// Push receipts: phones the app was uninstalled from stop being sent to.
every(RECEIPT_CHECK_MS, 'push receipts', () => push.checkReceipts());

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
