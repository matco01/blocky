# What Blocky is

> **Tell Blocky what you want to do with your money, and it handles the rest.**

Blocky is an AI-powered **money app**. You manage and move your money by
talking to it, like asking a friend who happens to be very good with money.

It is not a crypto app with a chatbot on top. Underneath it is a non-custodial
crypto wallet and onchain financial infrastructure, and that is what makes it
possible. But nobody downloads Blocky for the infrastructure. They download it
to handle their money without the hassle.

**All your money. One conversation.**

---

## The short version

| | |
|---|---|
| **What it is** | An AI-powered money app that lets you manage and move your money simply by talking to it. |
| **What's underneath** | A non-custodial crypto wallet and onchain financial infrastructure. The user never needs to understand it. |
| **Who it's for** | Anyone who wants more control over their money without learning complicated financial apps. |
| **Who especially** | People who want simple, accessible finances, including people curious about crypto who don't understand or trust today's crypto interfaces. |
| **Why download it** | To manage, move and use their money from one simple app. |
| **First 60 seconds** | Create an account → add money → start using it. |
| **What they must understand** | Almost nothing about crypto. They think about money, not chains, bridges, gas, wallets or protocols. |
| **Why not PayPal, Cash App, Revolut, Robinhood or Phantom** | Blocky brings more of your financial life into one place and lets you control it through conversation. |
| **The magic** | It moves money with your words. |
| **How it feels** | A friendly assistant for your money, not a complicated financial terminal. |
| **What the technology does** | Handles the complicated financial and onchain operations behind the scenes. |

---

## A money app, not a crypto app

This is the most important idea in this document, and the easiest one to drift
from.

Crypto is how Blocky works, not what Blocky is. Stablecoins, onchain
settlement and self-custody let us move money instantly, globally and cheaply,
and let the user truly own it. Those are the reasons we build on them. They are
not what we sell.

The product grows toward everything a money app does: holding, sending,
receiving, saving, investing, and **spending with a card**. Every one of those
goes through the same conversation, with Blocky as the friend who does the work.

---

## The full picture

> **Blocky is the friend who's good with money, and can actually do things.**
> It sees where your money goes, helps you spend it better, and handles the
> boring parts for you. You just say what you want, and approve.

The finished product does three things.

**It sees.** You pay with a Blocky card in shops and online, and every
purchase lands in the same conversation. Blocky knows where your money goes
in real life, not just onchain.

**It advises.** Blocky is the friend who's good with money:

- It catches impulse buys: *"You've spent $140 on clothes this week, and
  you're saving for Lisbon. Still want it?"*
- It finds a cheaper version of the same thing.
- It warns you before a subscription renews or a budget runs out.
- It knows your goals, so its advice is about you, not generic tips.

The coach is opt-in. It asks; it doesn't lecture. Nobody keeps an app that
makes them feel judged.

**It acts.** *"Order six nuggets and a drink from McDonald's to my place."*
Blocky places the order and pays. The same goes for bills, groceries,
subscriptions and bookings.

The rule that keeps today's payments safe carries over unchanged: **Blocky
proposes and the user approves.** Shopping for you is one more card to approve
with your fingerprint, never the AI spending on its own.

### How we get there

| Stage | What Blocky adds | Who it opens to |
|---|---|---|
| **Today** | Send, request and split; save in pots; invest in stocks and tokens; track spending; money moved between networks automatically. | People who already have money in crypto or on an exchange |
| **Next** | Add money from a bank or card, withdraw to a bank, and an iPhone app. | Anyone with a bank account, no crypto needed |
| **The full picture** | The Blocky card, through a licensed partner; the spending coach; Blocky shopping and paying for you. | People ready to make Blocky their main money app |

Each step needs partners we don't have yet: a licensed card issuer, ways to
add and withdraw money, and shops or delivery services Blocky can order from.
None of it changes the core: one conversation, plain words, and nothing moves
without the user.

---

## What this means when we build

These follow from the vision. If a decision fights one of them, the decision is
probably wrong.

**1. Talk about money, not machinery.**
The user sees dollars, people and outcomes, like "Send Sam $20" or "Put $50 into
ETH". They never have to choose a chain, a bridge, a route or a gas token.

| Say | Don't say |
|---|---|
| dollars, your money, your balance | assets, funds, tokens (unless they asked about one) |
| "moving to Base" / "your money on Arbitrum" | bridge, CCTP, Across, relayer |
| "a small network fee" | gas, gwei, paymaster |
| "approve with your fingerprint" | sign the transaction, calldata |

When the chain truly needs something from the user, Blocky handles it (for
example, adding a little gas money) or explains it in one plain sentence.

**2. Blocky thinks for the user.**
The agent's job is to understand what the person wants, check what they have,
think a step ahead, and find the best way to do it, such as the cheapest route
or the right top-up. The user states the goal; Blocky does the legwork.

**3. The user is always in control.**
Blocky proposes and the user approves. Nothing moves without their fingerprint,
face or PIN. Blocky never holds their money or their keys. That is a legal
line (we are not a custodian) and a trust line: *it's your money, and Blocky
works for you.*

**4. Friendly, simple, honest.**
Short answers. Real numbers. No jargon, no hype, and no advice to buy or sell.
If something can't be done yet, Blocky says so in one sentence and offers what
it can do. It is warm and a little playful, but never careless with money.

**5. One place for your financial life.**
New features join the conversation. They don't become new screens to learn.
If something can be said, it should be sayable to Blocky.

**6. Fair and clear on price.**
Everyday payments are free. Where Blocky charges, as on swaps and moves between
networks, the fee is small, shown up front, and cheaper than the big wallets.

---

## How it works, in one paragraph

You say what you want. The AI agent works out what you mean and proposes it,
but it never touches money or writes a transaction. A deterministic planner
turns the proposal into an exact, priced transaction and checks it against
your limits. You see a simple card showing what leaves, what arrives and the
fee, and you approve it with your fingerprint. The money moves from your own
wallet. See the [README](README.md) for the engineering detail.
