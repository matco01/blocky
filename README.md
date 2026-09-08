# Blocky

A non-custodial crypto wallet where an AI agent does the work.

The UI is your balance, Receive, and Send. Everything else — swapping, bridging,
finding a token, working out what you spent — happens by typing it to an agent.

## The one rule

> **The LLM never produces calldata, and never holds a key.**

The model picks from a small set of typed intents ([`packages/shared/src/intent.ts`](packages/shared/src/intent.ts)).
A deterministic planner turns an intent into a concrete transaction. The policy
engine ([`packages/shared/src/policy.ts`](packages/shared/src/policy.ts)) decides
whether it may run unattended. Only then is anything signed.

That boundary is what bounds the damage from both model error and prompt
injection — and prompt injection is a real attack here, because token names,
ENS records and transfer memos are attacker-controlled text that lands directly
in the agent's context.

The policy engine runs in two places on purpose: server-side, where it can
explain itself, and on-chain in the session key's validator, where the caps hold
even if this server is fully compromised.

## Layout

```
packages/shared/       Zod schemas shared by model, server and UI. Start here.
packages/wallet-core/  Chains, smart accounts, session keys, gas strategy.
apps/api/              Hono backend.
apps/mobile/           Expo app.
```

`packages/shared` is load-bearing: the Intent, Plan and Policy schemas are the
contract between every part of the system.

## Running it

Requires Node 22.13+ (Expo SDK 57 minimum).

```bash
npm install
cp .env.example .env     # then fill it in
npm run dev:api          # http://localhost:8787
npm run dev:mobile       # Expo
```

You need a **physical phone** from day one — passkeys don't work properly in the
iOS simulator, and passkeys are the whole onboarding story.

When running on a device, point the app at your machine rather than localhost:

```bash
EXPO_PUBLIC_API_URL=http://192.168.x.x:8787
```

### Keys you'll need

| Service | What for | Where |
|---|---|---|
| Privy | Passkey login + embedded signer | [dashboard.privy.io](https://dashboard.privy.io) |
| Alchemy | Base Sepolia RPC | [dashboard.alchemy.com](https://dashboard.alchemy.com) |
| ZeroDev | Bundler for the Kernel smart account | [dashboard.zerodev.app](https://dashboard.zerodev.app) |
| Anthropic | The agent (not needed until M2) | [console.anthropic.com](https://console.anthropic.com) |

## Checks

```bash
npm run typecheck
npm test
```

The policy and gas tests are the highest-value tests in the repo. If you change
`evaluatePolicy` or `selectGasStrategy`, the tests are the specification — read
them before the implementation.

## Gas, and why it works with zero ETH

EVM gas is paid in native token. Our users hold USDC and no ETH, so without
intervention their transactions cannot be broadcast at all. Three tiers resolve
that, in [`packages/wallet-core/src/gas.ts`](packages/wallet-core/src/gas.ts):

1. Plain USDC sends settle on Circle Gateway's gas-free path — no paymaster.
2. Everything else uses Circle Paymaster, which deducts gas **in USDC from the
   transaction itself**. (This is what "gas is included in the transaction"
   actually means mechanically.)
3. A new user's first few transactions are sponsored outright, so onboarding
   works at a literal zero balance.

Gas appears in exactly one place in the UI: the fee line of the confirmation
card, in dollars. It is never a question put to the user.

## Status

M0 complete. See the milestone plan for what's next.

- [x] **M0** — Monorepo, schemas, policy engine, gas strategy, API, app shell
- [ ] **M1** — Receive, Send, real Gateway balance, activity feed
- [ ] **M2** — Agent chat, read-only tools
- [ ] **M3** — Agent writes, with confirmation cards
- [ ] **M4** — Session keys, policy enforcement, revoke switch
- [ ] **M5** — Swaps and bridges

## Things that will bite you

- **Every mainnet token address in [`chains.ts`](packages/wallet-core/src/chains.ts)
  must be re-verified against Circle's published list before mainnet.** A wrong
  address sends real money somewhere unrecoverable.
- The M0 store is **in-memory**. Restarting the API forgets the user's spend
  history, which resets the daily cap. Fine for testnet, unacceptable with real
  money — Postgres lands in M1.
- Auth in M0 trusts an `x-blocky-user` header outright. Real Privy token
  verification lands in M1, before any route can move money.
- Importing Reanimated raises Android memory ~25-30% on SDK 57 even unused;
  worklets bundle mode is the workaround, and Hermes V1 is expected to fix it.
- **Cards and fiat are regulated money transmission.** A non-custodial wallet is
  largely fine; issuing cards needs a licensed partner and counsel. That's a
  company decision, not a codebase one.
