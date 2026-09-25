import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// One .env at the monorepo root, so the API and any future service agree.
loadDotenv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

/**
 * Environment, validated at boot.
 *
 * A wallet that starts up with a missing key and discovers it mid-transaction
 * is worse than one that refuses to start, so this throws loudly and lists
 * everything that is wrong at once.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),

  /** Privy — verifies the access token the mobile app sends. */
  PRIVY_APP_ID: z.string().min(1),
  PRIVY_APP_SECRET: z.string().min(1),

  /** Anthropic — the agent. The chat route 503s without it. */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  /**
   * Real money or test money. Anything but `mainnet` is testnet. The app has
   * its own switch (`EXPO_PUBLIC_NETWORK`) and the two must match — the app
   * refuses to sign a plan built for a chain it isn't on.
   */
  BLOCKY_NETWORK: z.enum(['mainnet', 'testnet']).default('testnet'),

  /**
   * Arc testnet, the home chain. Defaults to Circle's public endpoint, which is
   * rate-limited — fine for development, not for real traffic.
   */
  ARC_TESTNET_RPC_URL: z.string().url().default('https://rpc.testnet.arc.network'),

  /** Base Sepolia. Defaults to Base's own public endpoint — fine for development. */
  BASE_SEPOLIA_RPC_URL: z.string().url().default('https://sepolia.base.org'),

  /** Arbitrum Sepolia. Defaults to Arbitrum's own public endpoint. */
  ARBITRUM_SEPOLIA_RPC_URL: z.string().url().default('https://sepolia-rollup.arbitrum.io/rpc'),

  /**
   * Ethereum mainnet, for ENS lookups only — we do not transact there.
   * Optional: without it ENS names simply do not resolve, and the agent asks
   * for an address instead of guessing at one.
   */
  ETHEREUM_RPC_URL: z.string().url().optional(),

  /*
   * Mainnet endpoints. All optional: each falls back to the chain's public
   * endpoint (Arc's own, or viem's default), which is rate-limited — fine to
   * start on, worth replacing with a provider URL as traffic grows.
   */
  ARC_RPC_URL: z.string().url().optional(),
  BASE_RPC_URL: z.string().url().optional(),
  ARBITRUM_RPC_URL: z.string().url().optional(),
  OPTIMISM_RPC_URL: z.string().url().optional(),
  POLYGON_RPC_URL: z.string().url().optional(),
  UNICHAIN_RPC_URL: z.string().url().optional(),
  AVALANCHE_RPC_URL: z.string().url().optional(),
  HYPEREVM_RPC_URL: z.string().url().optional(),

  /**
   * Blockscout's API key, for the activity feed on mainnet. Arc's mainnet
   * explorer turns away server requests, so mainnet reads go through
   * Blockscout's hosted API, which needs a key (free tier:
   * https://dev.blockscout.com). Without one the feed still shows every send
   * made through Blocky, and says it is incomplete rather than hiding
   * payments received.
   */
  BLOCKSCOUT_API_KEY: z.string().min(1).optional(),

  /**
   * Postgres. Optional in development: without it the API runs an embedded
   * Postgres (PGlite) that persists to `.data/` at the repo root. Required in
   * production, where a local file is not a database.
   */
  DATABASE_URL: z.string().url().optional(),

  /**
   * Blocky's fee on swaps and moves out of Arc, paid to this address in the
   * same transaction as the move. Unset means no fee. Plain sends are always
   * free, and so is bringing money home.
   */
  BLOCKY_FEE_RECIPIENT: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a 0x-prefixed 20-byte address')
    .transform((value) => value.toLowerCase() as `0x${string}`)
    .optional(),
  /** The fee, in basis points: 50 is 0.5%. Capped at 1%. */
  BLOCKY_FEE_BPS: z.coerce.number().int().min(1).max(100).default(50),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Treat a blank value as an absent one.
 *
 * `.env.example` ships its keys with empty values, so the natural thing to do —
 * copy it and fill in only what you have — leaves optional keys as `''`. Zod's
 * `.optional()` accepts `undefined`, not `''`, so without this the API refuses
 * to boot over a key nothing has asked for yet. It also turns a blank *required*
 * key into "Required" rather than "Too small", which is the more useful error.
 */
function blanksAsAbsent(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value?.trim() !== ''),
  );
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(blanksAsAbsent(source));

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Invalid environment configuration:\n${problems}\n\nCopy .env.example to .env and fill it in.`,
    );
  }

  const env = result.data;

  if (env.NODE_ENV === 'production' && !env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required in production. The embedded dev database is not a database.');
  }

  return env;
}
