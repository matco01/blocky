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
