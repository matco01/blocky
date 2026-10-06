# Privacy & safety

What Blocky can see, what it keeps, what its AI can and can't do, and who
else is involved. Written to be checked: every claim here points at code in
this repository, which is open at **https://github.com/matco01/blocky**.
The same page is on the website at https://blocky.page/safety.

## The short version

- **Your money stays yours.** Blocky never holds your money or your keys.
  Nothing moves until you approve it with your fingerprint or face, on your
  phone.
- **The AI proposes and you decide.** Blocky's assistant can read your
  balances and suggest moves. It cannot sign, send or approve anything.
- **Your chat lives on your phone.** Recent messages go to the AI to get an
  answer. Our server passes them along and doesn't save them.
- **Everything onchain is public.** That's true of every crypto wallet,
  Blocky included: anyone can see what your address holds and sends.

---

## Your money

Blocky is **non-custodial**. Your wallet is created on your phone through
[Privy](https://privy.io), the wallet provider. Privy secures the key, and
neither Blocky's server nor its AI ever has it. You can export your private
key any time (Account → Export private key) and take your wallet to another
app.

- **Every move needs you.** Blocky prepares a transaction, your phone shows
  you exactly what it does, and nothing happens until you confirm with your
  fingerprint or face. "Approve all" is still one confirmation from you,
  covering cards you can see.
- **No server-side signing.** There is no key on our server that can move
  your money. Spending limits are checked on the server before a card is
  shown. They aren't an on-chain lock yet, and we're not pretending they are.
- **What a card shows is what gets signed.** The transaction behind a card
  is built by fixed, ordinary code (the planner) from live prices and chain
  data. The server checks it byte for byte before your phone will sign it.
  The AI never writes a transaction.

## Who sees what

| Who | What they see | Why |
| --- | --- | --- |
| **Blocky's server** | Your wallet address, username, the moves you make and the records listed below | To build cards, check limits and keep your history |
| **Anthropic (Claude)** | Each message you send the assistant, your last ~20 chat messages, and what its tools look up (balances, contacts, activity, saved notes) | Claude is the AI that answers you; see [Anthropic's terms](#anthropic) |
| **Privy** | Your email (or Google/Apple/passkey login) and your wallet | Signing in and securing your key |
| **Price, route and chain services** (Circle, Across, Gas.zip, Uniswap, CoinGecko, DefiLlama, Blockscout and others) | Your wallet address and the amounts involved, never your name or email | Quotes, bridges, swaps, prices and history |
| **Other Blocky users** | Your @username, and your wallet address when you pay them or request money | So people can pay you by name |
| **Everyone** | Everything on the blockchain: your address, balances and transactions | That's how public blockchains work |

Blocky has no ads, no analytics trackers and no data brokers, and doesn't sell data.

## What's stored where

**On your phone**

- Your chat with Blocky. "Reset chat" deletes it.
- Your appearance setting (light or dark mode).

**On Blocky's server**

- **Account:** your login ID from Privy, your wallet address and your @username. Your email isn't stored here; Privy holds it.
- **Your settings:** spending limits, the tokens Blocky may spend, and a list of addresses you've paid before.
- **Moves:** every card Blocky proposed, including amounts, recipient, fees, and the assistant's one-line description of it. Also whether you approved it, and the transaction hash.
- **Your saved people:** contacts you saved.
- **Notes:** short notes the assistant saved about you, such as "prefers dollars to percentages". Ask Blocky what it remembers, and tell it to forget any of them.
- **Money features:**
  - payment requests and their notes
  - people you blocked
  - notifications
  - price alerts
  - budgets
  - savings pots and auto-save rules
  - tokens you bought by contract
  - balance snapshots for your portfolio chart

**Not stored anywhere by Blocky**

- The text of your chat messages
- Your keys or seed phrase. There isn't one; Privy secures the key.
- Your password. There isn't one; you sign in with a code or passkey.

**Server logs** record what each AI reply cost: token counts and dollars.
They don't record what you said.

## What the AI can and can't do

**It can:**

- Read your balances, activity, contacts, pots, requests, budgets, notifications and settings, so it can answer questions about your money.
- Propose a move as a card for you to review: send, swap, buy or sell a stock or token, or move money between chains.
- Organise things that don't move money: save or delete a contact, create a pot, set a budget or price alert, request money, decline or block a request.
- Lower your spending limits when you ask. It can never raise them; only you can, on the Spending limits screen.
- Look up prices and market data, and search the web for news.
- Save short notes to remember you by, and forget them when asked.

**It can't:**

- **Sign, send or approve anything.** Every move is a card that waits for your fingerprint.
- **Spend past your limits**, or raise them.
- **Use an address you didn't give it.** A raw `0x…` address has to come from you, typed or pasted word for word into your chat. Otherwise it must be a saved contact, an @username, or an ENS name you typed. An address from a web page, a token's history, an incoming transfer or its own memory is refused before a card is made. Saving a contact follows the same rule.
- **Act on a web search.** A reply that searched the web can't propose a move in the same turn, because web pages are written by strangers.
- **Change the transaction behind a card.** The AI says what you want ("send Sam $20"), and fixed code works out how. If the two disagree, you see both.

## Address safety

Most crypto scams don't break anything. They get you to send money to the
wrong address. Blocky checks for the two common ways that happens:

- **Addresses only come from you.** See above: the AI can't put an address
  you never typed into a send.
- **Lookalike detection.** Scammers create addresses that start and end like
  one you know. Then they send you a tiny amount so the fake shows up in your
  history, waiting to be copied. That trick is called "address poisoning".
  When a send goes to an address that matches the start and end of one you
  know but isn't it, Blocky stops you with a red warning. "One you know"
  means a contact, someone you've paid, or your own wallet. The card shows
  both addresses in full, with the characters that differ underlined in red.
  A red warning always means the full review and a fingerprint, whatever
  your limits.

Sends to new addresses, contracts, unverified tokens, tokens that may not be
sellable, big price impact and money set aside in pots all get their own
warnings too.

## <a id="anthropic"></a>Anthropic's terms

Blocky's assistant is Claude, made by Anthropic, used through Anthropic's
commercial API. Under Anthropic's
[Commercial Terms](https://www.anthropic.com/legal/commercial-terms),
Anthropic doesn't train its models on what's sent through the API by default.
Anthropic keeps API data for a limited time for safety and abuse monitoring.
The details are in Anthropic's [Privacy Center](https://privacy.anthropic.com).

What Anthropic receives is listed under "Who sees what" above. It doesn't
receive your email, your keys, or anything the assistant didn't look up for
that reply.

## Open source

All of Blocky's code is at **https://github.com/matco01/blocky**: the app, the
server, the planner that builds transactions and the AI's instructions. You
don't have to take this page's word for anything. These parts are worth
reading:

- `packages/shared/src/intent.ts`: everything the AI can ask for, and nothing else
- `packages/planner`: how a request becomes a transaction
- `packages/shared/src/policy.ts`: spending limits and when a fingerprint is required
- `apps/api/src/agent.ts`: the AI's tools and the address rule
- `apps/api/src/money.ts`: the lookalike check
- `apps/api/src/db/schema.ts`: every table the server keeps

## Not done yet

- **Spending limits** are enforced by our server, not yet by your wallet
  onchain.
- **Deleting your account** from inside the app isn't built yet. Email
  blockywallet@gmail.com and we'll delete everything the server holds about you.

Questions or a problem: email **blockywallet@gmail.com**, or open an issue at
https://github.com/matco01/blocky/issues.
