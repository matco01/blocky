import { displayUsd, formatUsd, parseUsd, type Address, type Plan } from '@blocky/shared';
import { DEFAULT_CHAIN, readUsdcBalance, type ChainReader } from '@blocky/wallet-core';
import { monthInsights, previousMonth, spentInCategory, type BudgetCategory } from './insights';
import type { PaymentRequest, Store } from './store';

/**
 * The money-app layer both the chat and the screens share: this month's
 * insights with budgets beside them, and the warning a send gets when it
 * would spend money set aside in a pot.
 */

export function monthStart(month: string): Date {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, m - 1, 1));
}

/** This month and last, budgets beside what they've spent. */
export async function insightsFor(store: Store, userId: string, wallet: Address, month: string) {
  const since = monthStart(previousMonth(month));
  const [moves, received, budgets] = await Promise.all([
    store.listSettledMoves(userId, since),
    store.listReceivedFromUsers(wallet, since),
    store.listBudgets(userId),
  ]);
  const insights = monthInsights(month, moves, received);
  return {
    insights,
    budgets: budgets.map((budget) => ({
      ...budget,
      spentUsd: formatUsd(spentInCategory(insights, budget.category as BudgetCategory)),
    })),
  };
}

/**
 * Money a plan would spend that the user set aside in pots. Warned, not
 * refused: it's their money, and a pot is a promise they made themselves.
 */
export async function potWarning(store: Store, reader: ChainReader, userId: string, wallet: Address, plan: Plan): Promise<Plan> {
  const [pots, balance] = await Promise.all([store.listPots(userId), readUsdcBalance(reader, DEFAULT_CHAIN, wallet).catch(() => null)]);
  const setAside = pots.reduce((sum, pot) => sum + parseUsd(pot.savedUsd), 0n);
  if (setAside === 0n || !balance) return plan;

  const spendsArc = plan.outflow.filter((delta) => delta.token.chainId === DEFAULT_CHAIN);
  const spending = spendsArc.reduce((sum, delta) => sum + (delta.usdValue ? parseUsd(delta.usdValue) : 0n), 0n) + parseUsd(plan.fee.totalUsd);
  const free = balance.amount - setAside;
  if (spending <= free) return plan;

  const names = pots.filter((pot) => parseUsd(pot.savedUsd) > 0n).map((pot) => pot.name).join(', ');
  return {
    ...plan,
    warnings: [
      ...plan.warnings,
      {
        code: 'dips_into_pot',
        severity: 'warn',
        message: `This uses money you set aside (${names}). You have ${displayUsd(formatUsd(free > 0n ? free : 0n))} outside your pots.`,
      },
    ],
  };
}

/**
 * Two different addresses a person would mistake for each other: the same
 * opening and closing characters — what wallets show, and what people check.
 * Poisoners grind addresses to match six to ten of them; two random addresses
 * share six about once in sixteen million.
 */
export function looksAlike(a: Address, b: Address): boolean {
  const x = a.slice(2).toLowerCase();
  const y = b.slice(2).toLowerCase();
  if (x === y) return false;
  let prefix = 0;
  while (prefix < x.length && x[prefix] === y[prefix]) prefix++;
  let suffix = 0;
  while (suffix < x.length && x[x.length - 1 - suffix] === y[y.length - 1 - suffix]) suffix++;
  return prefix >= 2 && suffix >= 2 && prefix + suffix >= 6;
}

/**
 * A recipient that imitates someone the user knows — a contact, anyone they've
 * paid, or their own wallet — gets a red warning naming who it imitates. The
 * card then shows both addresses in full with the differences marked.
 */
export async function lookalikeWarning(store: Store, userId: string, wallet: Address, plan: Plan): Promise<Plan> {
  const recipient = plan.recipient?.address;
  if (!recipient) return plan;

  const [contacts, policy] = await Promise.all([store.listContacts(userId).catch(() => []), store.getPolicy(userId).catch(() => null)]);
  const known: Array<{ address: Address; name: string }> = [
    { address: wallet, name: 'your own wallet' },
    ...contacts.map((contact) => ({ address: contact.address, name: contact.label })),
    ...(policy?.recipientAllowlist ?? []).map((address) => ({ address, name: 'someone you’ve paid before' })),
  ];

  // An exact match is the real thing, whatever else it resembles.
  if (known.some((entry) => entry.address.toLowerCase() === recipient.toLowerCase())) return plan;
  const imitated = known.find((entry) => looksAlike(recipient, entry.address));
  if (!imitated) return plan;

  return {
    ...plan,
    warnings: [
      ...plan.warnings,
      {
        code: 'address_lookalike',
        severity: 'danger',
        message: `This address looks like ${imitated.name}, but it isn’t. Scammers copy the start and end of addresses you know. Check every character before you send.`,
        lookalikeOf: imitated.address,
      },
    ],
  };
}

/** Every check a send gets on top of the planner's: pots, then lookalikes. */
export async function moneyWarnings(store: Store, reader: ChainReader, userId: string, wallet: Address, plan: Plan): Promise<Plan> {
  return lookalikeWarning(store, userId, wallet, await potWarning(store, reader, userId, wallet, plan));
}

/* -------------------------------------------------------------------------- */
/*  Requests                                                                   */
/* -------------------------------------------------------------------------- */

/** "@sam", or "Someone" for a user who hasn't picked a name. */
export function who(username: string | null): string {
  return username ? `@${username}` : 'Someone';
}

/** Opens the request in Blocky. */
export function payLink(requestId: string): string {
  return `blocky://pay/${requestId}`;
}

export function shareText(request: PaymentRequest): string {
  const what = `${displayUsd(request.amountUsd)}${request.note ? ` for ${request.note}` : ''}`;
  return `${who(request.requesterUsername)} is asking for ${what}. Pay on Blocky: ${payLink(request.id)} — or send USDC on Arc to ${request.requesterWallet}.`;
}

export type RequestResult =
  | { ok: true; request: PaymentRequest; link: string; shareText: string }
  | { ok: false; status: 400 | 404 | 429; message: string };

/** Open requests one person may have to another at once. */
const MAX_OPEN_TO_ONE = 3;
/** Requests one person may make in a day, to anyone. */
const MAX_PER_DAY = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Ask someone to pay: another Blocky user by name (who is told, and sees it
 * to pay), or nobody in particular — a link to share.
 */
export async function createRequest(
  store: Store,
  requesterId: string,
  input: { payer: string | null; amountUsd: string; note: string | null },
): Promise<RequestResult> {
  const amount = /^\d+(\.\d{1,6})?$/.test(input.amountUsd.trim().replace(/^\$/, '')) ? parseUsd(input.amountUsd.trim().replace(/^\$/, '')) : 0n;
  if (amount <= 0n) return { ok: false, status: 400, message: 'Ask for an amount in dollars, more than nothing.' };

  const payer = input.payer ? await store.findUserByUsername(input.payer) : null;
  if (input.payer && !payer) {
    return { ok: false, status: 404, message: `Nobody on Blocky goes by @${input.payer.replace(/^@/, '')}. Share a link instead.` };
  }
  if (payer?.id === requesterId) return { ok: false, status: 400, message: "You can't ask yourself." };

  // Rate limits: nobody floods anyone, or everyone.
  if (payer && (await store.countOpenRequests(requesterId, payer.id)) >= MAX_OPEN_TO_ONE) {
    return { ok: false, status: 429, message: `You already have ${MAX_OPEN_TO_ONE} open requests to @${payer.username}. Wait for those first.` };
  }
  if ((await store.countRequestsSince(requesterId, new Date(Date.now() - DAY_MS))) >= MAX_PER_DAY) {
    return { ok: false, status: 429, message: `That's ${MAX_PER_DAY} requests today — try again tomorrow.` };
  }

  // Someone they've never dealt with asks quietly: no notification, a pile of
  // its own. Someone they blocked isn't told — the request just goes nowhere.
  const requester = await store.getUser(requesterId);
  const blocked = payer ? await store.isBlocked(requesterId, payer.id) : false;
  const stranger = payer && requester ? !(await store.knowsUser(payer.id, requester)) : false;

  const request = await store.createPaymentRequest({
    requesterId,
    payerId: payer?.id ?? null,
    amountUsd: formatUsd(amount),
    note: input.note?.trim().slice(0, 140) || null,
    fromStranger: stranger,
  });

  if (blocked) {
    await store.settleRequest(request.id, 'declined');
    return { ok: true, request, link: payLink(request.id), shareText: shareText(request) };
  }

  if (payer && !stranger) {
    await store.notify(payer.id, {
      kind: 'request_received',
      title: `${who(request.requesterUsername)} requested ${displayUsd(request.amountUsd)}`,
      body: request.note ?? 'Tap to pay or decline.',
      data: { requestId: request.id },
    });
  }

  return { ok: true, request, link: payLink(request.id), shareText: shareText(request) };
}

/**
 * A send that pays someone who is asking this user for exactly that much is
 * paying their request: tie them together, so the request settles itself
 * when the send lands. Within a cent, oldest request first.
 */
export async function linkMatchingRequest(store: Store, userId: string, plan: Plan): Promise<void> {
  if (plan.intentType !== 'transfer' || !plan.recipient) return;
  const sent = plan.outflow[0]?.usdValue;
  if (!sent) return;

  const { incoming } = await store.listPaymentRequests(userId);
  const match = incoming
    .filter((request) => request.status === 'open' && request.planId === null)
    .filter((request) => request.requesterWallet.toLowerCase() === plan.recipient!.address.toLowerCase())
    .filter((request) => {
      const gap = parseUsd(request.amountUsd) - parseUsd(sent);
      return gap <= 10_000n && gap >= -10_000n;
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];

  if (match) await store.linkRequestPlan(match.id, plan.id);
}

