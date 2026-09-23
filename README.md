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
packages/agent/        The model, and the boundary around it.
packages/planner/      Intent in, Plan out. Deterministic.
apps/api/              Hono backend.
apps/mobile/           Expo app.
```

`packages/shared` is load-bearing: the Intent, Plan and Policy schemas are the
contract between every part of the system.

## Running it

Requires Node 22.13+ (Expo SDK 57 minimum).

```bash
npm install
cp .env.example .env                        # API config
cp apps/mobile/.env.example apps/mobile/.env  # app config
npm run dev:api                             # http://localhost:8787
npm run dev:mobile                          # Expo
```

The API needs nothing else installed: without `DATABASE_URL` it runs embedded
Postgres (PGlite) persisted to `.data/`, and without `ARC_TESTNET_RPC_URL` it
uses Circle's public Arc endpoint.

### The app needs a development build, not Expo Go

Privy's native modules (passkeys, secure key storage) are not in Expo Go. Build
the app once with `npx expo run:android` / `npx expo run:ios`, or with
[EAS Build](https://docs.expo.dev/build/introduction/) — building for iOS needs
a Mac or EAS. After that, `npm run dev:mobile` hot-reloads into it.

Use a **physical phone**. On a device, `EXPO_PUBLIC_API_URL` must be your
computer's LAN address, not `localhost`.

### Keys and dashboard setup

| Service | What for | Where |
|---|---|---|
| Privy | Login + the embedded wallet | [dashboard.privy.io](https://dashboard.privy.io) |
| Anthropic | The agent | [console.anthropic.com](https://console.anthropic.com) |
| Pimlico *(optional)* | Bundler API key once past the public rate limit | [dashboard.pimlico.io](https://dashboard.pimlico.io) |

In the Privy dashboard: enable **email** login, enable **Ethereum embedded
wallets**, and add the app identifier `com.blocky.wallet` as an allowed mobile
client (put its client id in `EXPO_PUBLIC_PRIVY_CLIENT_ID`).

No ZeroDev account is needed. We use ZeroDev's open-source Kernel contracts and
SDK, which require no dashboard, with Pimlico as the bundler.

**Passkeys** need a domain you own: host Apple's `apple-app-site-association`
and Android's `assetlinks.json` there, register it in Privy, and set
`EXPO_PUBLIC_PASSKEY_RP`. Until then the app offers email login only.

### Test money

Arc testnet USDC comes from Circle's faucet at
[faucet.circle.com](https://faucet.circle.com) — Arc Testnet is its default
network, 20 USDC per address every 2 hours. Send it to the address on the
Receive screen. No ETH is ever needed.

## Checks

```bash
npm run typecheck
npm test
```

The policy and gas tests are the highest-value tests in the repo. If you change
`evaluatePolicy` or `selectGasStrategy`, the tests are the specification — read
them before the implementation.

## Arc is the home chain

Blocky runs on [Arc](https://www.arc.io), Circle's L1, where **USDC is the native
gas token**. A user holding only USDC pays gas from that same balance — no ETH,
no paymaster, no sponsorship. USDC moves from Arc to other chains through
Circle's CCTP (see "Moving money between chains").

Everything the send path depends on was checked against the live Arc testnet,
not just the docs: chain id 5042002, USDC `decimals()` = 6, EntryPoint v0.7 and
v0.8 deployed, EIP-7702 authorizations charged the spec's 25,000 gas, Kernel
v3.3's 7702 delegate deployed, Pimlico's bundler serving the chain, Circle
Gateway's balance API, and ArcScan's transfer API.

> **Arc's decimals trap.** The same USDC is visible at **18 decimals** natively
> (`eth_getBalance`, gas prices, fees) and at **6 decimals** through the ERC-20
> at `0x3600…`. Mixing them is a 10¹² error. `nativeToUsdcUnits` and
> `usdcUnitsToNative` in [`chains.ts`](packages/wallet-core/src/chains.ts) are
> the only code allowed to cross scales. Never add a native balance to an ERC-20
> balance — it is the same money counted twice.

## How a send works

1. **Plan.** The app sends recipient and amount to `POST /v1/plans` (or the agent
   proposes an intent). The server plans it with the same planner either way:
   resolves the recipient, reserves the fee, builds the calldata, attaches
   warnings.
2. **Review.** The confirmation card shows the *server's* plan — what leaves,
   to whom, the fee in dollars — with a 60-second quote.
3. **Approve.** Face ID (or passcode). Nothing signs without it.
4. **Sign and submit.** The user's Privy embedded wallet is upgraded in place to
   a ZeroDev Kernel v3.3 account with EIP-7702 — signed once, on first send —
   and the call goes out as a user operation through Pimlico. Gas comes from
   the user's USDC.
5. **Verify.** The app reports the transaction hash. The server does not take
   its word for it: the receipt must contain exactly the planned USDC transfer
   — right token contract, sender, recipient and amount — or nothing is
   recorded. A plan executes at most once.

## Gas, and why it works with zero ETH

In [`packages/wallet-core/src/gas.ts`](packages/wallet-core/src/gas.ts) there
are exactly two routes, and nobody but the user pays for either:

1. **Arc: gas in USDC**, paid from the balance being spent.
2. **Anywhere else: the chain's own gas token** (ETH on Base, POL on Polygon),
   which the user must hold there in an amount that covers the fee. If they
   don't, they are told which token they need and where.

There is no sponsorship and no Circle Paymaster. A user who wants to act on
another chain needs that chain's gas token, and the planner says so before they
move money there.

Two claims from an earlier version were wrong and have been removed:
*"Gateway transfers are gas-free"* (a Gateway transfer ends in a `gatewayMint`
someone pays for, and a same-chain send is not a Gateway operation at all), and
*"Circle Gas Station sponsors onboarding"* (Gas Station sponsors Circle's own
wallets, not an arbitrary smart account). A tier promising $0 fees with nothing
behind it produces plans that fail on-chain.

Because gas comes out of the same USDC being sent, the planner reserves the fee
for **every** amount, not just "send max" — otherwise "send my last $10" plans
cleanly and fails at execution.

Gas appears in exactly one place in the UI: the fee line of the confirmation
card, in dollars. It is never a question put to the user.

## Status

- [x] **M0** — Monorepo, schemas, policy engine, gas strategy, API, app shell
- [x] **M1** — Privy login, Arc smart account, Receive, Send, real balance, activity feed, Postgres
  *(built and tested; not yet run end to end on a device — see below)*
- [x] **M2** — Agent, read-only tools *(server side; the app has no chat screen yet)*
- [ ] **M3** — Agent writes: server plans and verifies them; the app's chat screen and agent confirmation flow are not built
- [ ] **M4** — Session keys: server-side policy, authorisation and revoke done; on-chain validator not installed, so nothing signs unattended
- [ ] **M5** — Swaps and bridges: moving USDC from Arc to other chains is built (CCTP); swaps are not

**Not yet verified on a real device.** Everything above typechecks, 240 tests
pass, both platforms bundle, and every external API was probed live — but the
full loop (Privy login → first 7702 authorization → user operation on Arc →
server verification) has not been run on a phone with real testnet USDC. That
is the next thing to do, and the first place to look if something breaks.

## Design direction *(ideas, not final)*

### Mascot: the sprout block

A small wooden block with a sprout growing out of the top.

- **Why a block:** the product is called Blocky, and "block" means both a
  blockchain block and a building block.
- **Why the sprout:** a plain square is too generic. Like Phantom's ghost with
  its wavy bottom, the character needs one distinctive feature that makes the
  silhouette unmistakable, and the sprout is it. It also says the right thing
  about money: it grows. The leaf alone can work as a tiny logo mark.
- **Simple enough to work at 16px:** a rounded block, two dot eyes, no mouth,
  no limbs. Expression comes from the eyes, posture and the leaf.
- **The app icon is its face.** App icons are already rounded squares.

**The mascot is the agent.** It shouldn't be a logo in the corner; it's the face
of the chat. It waves on the empty chat, the leaf wiggles while it thinks
(replacing the dots), it hops when a send lands, and the leaf droops next to a
warning. People trust a character with their money more than "an AI".

**The one rule: it never jokes about money.** Failed sends, danger warnings and
the approval screen stay calm and plain.

Also considered: an ice cube ("cold storage" pun, but melting reads as losing
money), a block of cheddar (money slang, maybe too jokey), a delivery box
(sending as a package), a tiny vault. Avoid Lego-style studs (protected
shape), dice (gambling) and pixel/voxel cubes (reads as Minecraft).

### The Block system

Defined in [`theme/tokens.ts`](apps/mobile/theme/tokens.ts); nothing reads a raw
hex outside it.

- **Everything is a tile or a block.** Tiles are flat surfaces with a stroke
  (2 px light, 1 px dark) and no shadow. Blocks are the tappable things: rounded
  squares — never pills — sitting on a 4 px darker edge that collapses when
  pressed ([`BlockPressable`](apps/mobile/components/BlockPressable.tsx)). The
  edge is only ever on something tappable, so it reads as "press me".
- **Green is the action, maroon is the identity, red is danger.** Both brand
  colours come from the mascot — maroon is its body, the leaf green a fresher
  descendant of its olive leaf. Maroon is never a button: a dark-red "Send $50"
  next to green money-in and red errors reads as a warning to someone new to
  all this. It carries the wordmark, the card and the user's own chat bubbles.
- **Figtree** for everything, 800 for headlines. **Ionicons** only.
- **Blocky is fixed above the chat**, beside a speech bubble that only appears
  when there is nothing else to read (the empty state, "Thinking…") — never a
  second place where replies show up. He shrinks once the conversation starts
  and docks smaller when you scroll or type.
- **No glass, no blur.** `expo-glass-effect` is iOS-26-only and renders a plain
  view on Android; a design that only looks right on one platform isn't one.

## Things that will bite you

- **Every mainnet token address in [`chains.ts`](packages/wallet-core/src/chains.ts)
  must be re-verified against Circle's published list before mainnet.** A wrong
  address sends real money somewhere unrecoverable.
- **Arc mainnet launches September 16, 2026** and its contract addresses were not
  published when this was written. Arc mainnet is not in the chain registry, on
  purpose — add it from Circle's published addresses, never by guessing that the
  testnet ones carry over.
- **Simulation is not wired up.** Every plan carries a `simulation_failed` warning
  (`warn`, not `danger`). See "A note on severity" below before letting anything
  execute unattended.
- **Development uses public endpoints**: Circle's Arc RPC and Pimlico's public
  bundler are rate-limited. Use keyed endpoints before real traffic.
- The embedded dev database lives in `.data/`. Delete that folder to reset local
  state; it is gitignored. Production must set `DATABASE_URL`.
- `.npmrc` sets `legacy-peer-deps`: Privy's Expo SDK has optional peers
  (`permissionless`) whose own optional peers conflict with viem. Nothing uses
  them, but the flag means npm no longer installs peer dependencies for you —
  a missing native module shows up as a Metro "Unable to resolve" error, and the
  fix is to add it explicitly (`npx expo install <name>`).
- **viem is pinned to exactly 2.56.0** (root `overrides`), because Privy's Expo
  SDK requires that exact version. Upgrade them together.
- Importing Reanimated raises Android memory ~25-30% on SDK 57 even unused;
  worklets bundle mode is the workaround, and Hermes V1 is expected to fix it.
- **Cards and fiat are regulated money transmission.** A non-custodial wallet is
  largely fine; issuing cards needs a licensed partner and counsel. That's a
  company decision, not a codebase one.

## The agent

`packages/agent` is the only place the Anthropic SDK is imported, the same way
vendor chain SDKs are confined to `wallet-core`. What leaves it is either prose
for the user or a validated `Intent` — never calldata, never a key, and never a
decision about whether something may run.

It runs **Sonnet 5 at `low` effort**. Turning "send Sam twenty" into one of three
typed intents is closer to classification than reasoning, and effort is the
lever that most directly sets what a turn costs.

Three things in [`agent.ts`](packages/agent/src/agent.ts) are load-bearing:

- **`propose_intent` is terminal.** When the model calls it the turn ends and
  control returns to the caller. The model never observes whether its proposal
  was accepted, because that decision is not its to make. This is why the loop
  is hand-written rather than using the SDK's tool runner.
- **Malformed intents are handed back, never repaired.** The model gets two
  attempts against real validation errors, then we surface the failure.
- **One cache breakpoint, on the system block.** The API renders
  tools → system → messages, so that single breakpoint covers the tool schemas
  and the prompt — about 4,300 tokens of stable prefix — while the conversation
  varies freely outside it. Watch `usage.cacheReadTokens`: if it is ever zero on
  a second turn, something has made the prefix unstable and input cost has
  roughly tripled. Never interpolate anything into `SYSTEM_PROMPT`.

Prompt injection is handled by fencing. Token names, ENS records and memos are
attacker-controlled text that lands in the model's context verbatim, so every
tool result is wrapped in unguessable `<untrusted-data>` markers, with any
occurrence of those markers stripped from the payload first — a fence you can
close from the inside is not a fence. Verified against a live injection that
tries exactly that.

### What the agent can do beyond sending

Past `get_balance` / `get_policy` / `get_supported_chains` / `list_contacts` /
`propose_intent`, the agent has:

- **`get_token_price`** — a live market price for a curated list of well-known
  tickers ([`packages/wallet-core/src/prices.ts`](packages/wallet-core/src/prices.ts),
  DefiLlama's free `coins.llama.fi` feed, no key required). Curated rather than
  a general search: guessing a slug for an unlisted symbol risks quoting the
  wrong asset with complete confidence, so an unlisted symbol comes back as "no
  price available," never a guess. This number is for the user to read, never
  for the model to do money math with — the system prompt says so explicitly,
  and it was checked against a live model that it doesn't use the price to
  compute a transfer amount on its own.
- **`resolve_address`** — preview an address or ENS name without proposing
  anything. Exists mainly so the model can turn "vitalik.eth" into a real
  address before `save_contact`, which only accepts one.
- **`save_contact`** / **`delete_contact`** — the agent can build the user's
  contact book conversationally. This is deliberately *not* the same
  authority as sending: saving a contact never touches the recipient
  allowlist that governs unattended sends, and the system prompt is explicit
  that the two are unrelated.
- **`get_recent_activity`** — reuses the exact merge
  ([`mergeActivity`](apps/api/src/activity.ts)) that the Activity screen
  renders, so the agent's answer about the past can never disagree with what
  the user sees when they look themselves.

## The planner

`packages/planner` is the deterministic half: an `Intent` in, a `Plan` out. It
resolves what the model only named, works out the exact quantity, picks the gas
route, builds the calldata and attaches the warnings. Nothing it produces comes
from model output beyond the validated shape of the intent.

It is **pure**, in the same way `evaluatePolicy` and `selectGasStrategy` are.
Every chain read, price lookup and screening call arrives through
[`PlannerContext`](packages/planner/src/context.ts), so the whole thing runs
offline in milliseconds against a fake. The viem-backed implementation lives in
[`apps/api/src/planner-context.ts`](apps/api/src/planner-context.ts) and the RPC
primitives in [`wallet-core/src/rpc.ts`](packages/wallet-core/src/rpc.ts) — the
only file that imports viem.

Things worth knowing before changing it:

- **`calls.ts` is the only place calldata is assembled**, and it is hand-encoded
  rather than delegated to a library. ERC-20 `transfer` is a selector and two
  32-byte words; the file where a wrong byte sends money to the wrong place is
  not the file to add a dependency to. It throws on overflow rather than
  wrapping.
- **The summary is computed, not echoed.** `summary` comes from resolved facts
  and `modelRationale` is carried through untouched, so a model that has
  misunderstood the request produces a visible mismatch on the confirmation card
  rather than a convincing story.
- **Unresolvable means ask, never guess.** An unknown token, an unresolvable
  recipient or a USD amount for an unpriced token all fail with a message the
  agent can say out loud. None of them fall back to a best match.
- **Swaps fail loudly**, for the same reason `deriveSessionPermissions` throws
  on swap: a half-built money-moving path is worse than an absent one, because
  it looks finished.

### Moving money between chains

A `bridge` intent moves the user's own USDC from Arc to their wallet on another
chain through Circle's CCTP v2 with its Forwarding Service
([`cctp.ts`](packages/wallet-core/src/cctp.ts)). Two calls, signed as one
operation on Arc: an exact-amount `approve`, then `depositForBurnWithHook`.
Circle mints on the destination and takes its cost out of the transfer, so the
user pays every fee from their Arc USDC — Arc gas, plus Circle's fee, which is
quoted as a ceiling and whatever it doesn't use arrives with the money — and
needs nothing on the destination. The amount asked for is the amount that
arrives.

The server verifies the burn like it verifies a send: the receipt must contain
a `DepositForBurn` from the user's account, for the exact amount, minting to
the user's own address on the planned destination, with no higher fee ceiling
than the card showed. Contract addresses and the event were checked against
live Arc, Base Sepolia and Arbitrum Sepolia; mainnet addresses stay out until
they are checked the same way.

Only out of Arc, only USDC, only to yourself: the app signs on Arc alone, CCTP
moves only USDC, and paying someone else on another chain is a different
intent.

### The destination-gas warning

Arc takes gas in USDC. Everywhere else, *every* transaction — including
sending the USDC back out — needs that chain's gas token, which a Blocky user
moving money there for the first time does not hold.

`destination_no_gas_route` says so on the card of a move between chains, naming
the token and the chain, and the agent recommends getting a little of it. It is
`warn`, not `danger`: the money is not lost, and making it `danger` would force
confirmation on ordinary moves and train people to tap through warnings.

`canPayForGeneralAction` in [`gas.ts`](packages/wallet-core/src/gas.ts) answers
the underlying question by asking `selectGasStrategy`, rather than keeping a
second copy of the rule. Two copies would eventually disagree.

### Prices

One request to DefiLlama prices every token the app knows, and one cached
snapshot serves every user for 30 seconds
([`prices.ts`](packages/wallet-core/src/prices.ts)): live enough for a
portfolio, and a flat cost however many people are looking. Prices value
holdings and size fees paid in a gas token; they never decide how much of
something is sent.

### A note on severity

`evaluatePolicy` escalates to human confirmation on `danger` warnings only.
A missing dry run is a `warn`, so a small transfer to a known recipient still
auto-executes without ever having been simulated. That is deliberate for now —
`warn` severity is not meant to block — but it is the kind of default worth
revisiting before real money moves.

## Recipients: contacts and ENS

A destination reaches the planner one of four ways, and none of them let the
model invent one:

| Kind | Resolves via | Fails to |
|---|---|---|
| `address` | itself, with any ENS name attached for display | — |
| `ens` | Ethereum mainnet, always | a clarifying question |
| `contact` | the user's saved labels | a clarifying question |
| `self` | the user's own wallet | — |

Contacts are the only free-text handle the agent may use, and that is safe for
exactly one reason: a label resolves against the user's saved list or it fails.
`list_contacts` lets the agent see what exists so it asks a useful question
("you have Sam") instead of guessing at a label.

**Saving a contact does not allowlist them.** "I know who this is" and "the
agent may pay them without asking me" are separate statements, and the routes
keep them separate — a saved contact still raises `new_recipient` and still
needs a tap.

ENS resolves on Ethereum mainnet regardless of which chain the transfer settles
on, because ENS is a naming layer rather than a per-chain registry. That needs
`ETHEREUM_RPC_URL`; without it, names simply do not resolve and the agent asks
for an address. viem needs a real chain object on the client for this — one
built with only a transport has no universal resolver address and every lookup
fails looking like a network error.

> **Normalise every address that comes out of a chain read.** viem returns
> EIP-55 checksummed addresses; `AddressSchema` stores everything lowercased so
> allowlist checks are never checksum-sensitive. An address that skips that
> normalisation is a *different string* to `isKnownRecipient`, so a recipient
> the user explicitly allowlisted reads as a stranger forever. This bit us once
> on the ENS path already — see `rpc.test.ts`.

## Session keys

`POST /v1/session` derives on-chain permissions from the policy the user
actually set, via `deriveSessionPermissions`, which may only ever narrow it. A
default session grants exactly one target (USDC), one selector (`transfer`) and
a spend limit equal to the **daily** cap — the per-transaction cap is enforced
server-side, but the daily cap is the one that has to survive a compromised
server, because it bounds total loss rather than loss per attempt.

`authoriseCalls` in [`session.ts`](packages/wallet-core/src/session.ts) is the
server-side mirror of the on-chain validator. It exists so a call the chain
would reject is refused with an explanation rather than submitted and reverted
at the user's expense. It must never be more permissive than the validator, so
it refuses anything it cannot measure — calldata it cannot decode an amount
from does not get signed. Spend limits are checked across the whole batch,
because three transfers that each pass alone can breach the cap together.

`DELETE /v1/session` is the revoke switch: unconditional, no parameters, no
partial revocation. The one operation a frightened user performs must not have
options.

> ⚠️  **The on-chain half is not built.** These permissions are enforced
> server-side only, which stops mistakes but not a compromised server — the
> weaker half of the guarantee. Installing the permission validator on the
> user's Kernel account needs the user's device signature, and nothing signs
> unattended until it exists. Every session response says `onChain: false` for
> that reason. The Kernel account itself is live — the app already delegates to
> it with EIP-7702 on the first send.

