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

  /** Anthropic — the agent. Not needed until M2. */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  /** RPC. Alchemy or any standard provider. */
  BASE_SEPOLIA_RPC_URL: z.string().url(),

  /**
   * Ethereum mainnet, for ENS lookups only — we do not transact there.
   * Optional: without it ENS names simply do not resolve, and the agent asks
   * for an address instead of guessing at one.
   */
  ETHEREUM_RPC_URL: z.string().url().optional(),

  /** ZeroDev — smart account bundler and paymaster. */
  ZERODEV_PROJECT_ID: z.string().min(1).optional(),
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

  return result.data;
}
