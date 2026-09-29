import Anthropic from '@anthropic-ai/sdk';
import { estimateCostUsd, runAgentTurn, type AgentTools, type AgentTurn } from '@blocky/agent';
import { buildPlan } from '@blocky/planner';
import {
  AddressSchema,
  displayUsd,
  evaluatePolicy,
  formatUnits,
  formatUsd,
  parseUsd,
  type Address,
  type Plan,
  type PolicyDecision,
  agentChainName,
  type AgentChainName,
  type Intent,
} from '@blocky/shared';
import {
  DEFAULT_CHAIN,
  canMoveUsdcBetween,
  chainsOnNetwork,
  fetchWalletHoldings,
  getArcProtocols,
  getChain,
  fetchMarketOverview,
  getTokenPriceUsd,
  getTokenPricesByAddress,
  readUsdcBalance,
  type ChainReader,
  STOCKS,
  STOCK_CHAIN,
  IS_TESTNET,
} from '@blocky/wallet-core';
import { mergeActivity, type ExplorerTransfer } from './activity';
import { createRequest, insightsFor, linkMatchingRequest, potWarning, who } from './money';
import { BUDGET_CATEGORIES, monthOf } from './insights';
import { createPlannerContext, type BlockyFeeTerms } from './planner-context';
import type { SaveRule, Store } from './store';

/**
 * The agent route's plumbing.
 *
 * message → intent → plan → policy decision, against the user's real wallet.
 * Signing happens on the device: the plan is stored, the app shows the card,
 * and the user approves with Face ID.
 *
 * Every plan comes back for the user to approve, including `auto_execute`.
 * That outcome means the plan cleared the user's own limits, so the app can
 * offer it as one tap instead of a review screen — it does not mean the agent
 * may sign.
 *
 * This is a deliberate boundary, not an unfinished one. A key our server can
 * sign with alone would be sufficient by itself to move a user's funds, which
 * is the test both FinCEN ("total independent control") and MiCA ("the
 * exercise of control over such crypto-assets on behalf of clients") use to
 * decide whether you are custodying. Keeping the user's fingerprint on every
 * transfer is what keeps Blocky a software provider. Revisit only with
 * counsel, and preferably as a co-signer that is necessary but not sufficient.
 */

/** Enough for any sensible plan; a cap so a looping model can't pile them up. */
const MAX_SAVE_RULES = 10;

/** An auto-save rule as the agent reads it back — and as it says it to the user. */
function describeRule(rule: SaveRule, potName: string) {
  const what =
    rule.kind === 'percent_in'
      ? `${rule.percent}% of money received goes into ${potName}`
      : rule.kind === 'recurring'
        ? `${displayUsd(rule.amountUsd ?? '0')} goes into ${potName} every ${rule.everyDays === 30 ? 'month' : 'week'}`
        : `everything above ${displayUsd(rule.amountUsd ?? '0')} free goes into ${potName}`;
  return { id: rule.id, pot: potName, rule: what };
}

/**
 * The agent's tools, bound to one user.
 *
 * Constructed per request and closed over a single `userId` and wallet, so no
 * argument the model supplies can reach somebody else's data. Most only read;
 * the contact tools write, but only to this user's own address book.
 */
export function agentToolsFor(
  store: Store,
  userId: string,
  reader: ChainReader,
  account: Address,
  explorerTransfers: (address: Address) => Promise<ExplorerTransfer[]>,
): AgentTools {
  return {
    /**
     * Read from the same chain the planner reads.
     *
     * These two disagreeing is worse than either being wrong alone: the agent
     * talks the user out of a transfer the planner would have built, or promises
     * one it then refuses. So this is the *spendable* Arc balance, the same
     * number the Home screen shows — not Gateway deposits, which no plan can
     * spend yet.
     */
    /**
     * Everything the wallet holds: the USDC on Arc a send can spend, and what
     * sits on other chains — USDC moved there and gas tokens swapped into. The
     * agent has to see all of it, or it offers to move USDC that is really
     * ETH, and the user gets a refusal instead of an answer.
     */
    async getBalance() {
      try {
        const [{ amount, usd }, holdings] = await Promise.all([
          readUsdcBalance(reader, DEFAULT_CHAIN, account),
          store
            .listTrackedTokens(userId)
            .then((tracked) => fetchWalletHoldings(reader, account, fetch, tracked))
            .catch(() => null),
        ]);

        const elsewhere = (holdings ?? []).map((holding) => ({
          chain: getChain(holding.chainId).name,
          // The name a proposal uses for it.
          key: agentChainName(holding.chainId),
          token: holding.symbol,
          // Bought by contract: what a sale has to name it by.
          ...(holding.address ? { contract: holding.address } : {}),
          amount: formatUnits(BigInt(holding.amount), holding.decimals),
          usdValue: holding.usd,
        }));
        const elsewhereUsd = elsewhere.reduce((sum, h) => sum + (h.usdValue ? parseUsd(h.usdValue) : 0n), 0n);

        return {
          totalUsd: formatUsd(amount + elsewhereUsd),
          onArc: { usdc: usd, spendable: true },
          otherChains: elsewhere,
          // Said, not implied: a read that failed is not an empty list.
          ...(holdings === null ? { otherChainsUnavailable: true } : {}),
        };
      } catch {
        // Say we could not read it. A zero here reads as "you have no money",
        // which is a different and much more actionable claim.
        return { error: 'Balance is temporarily unavailable.' };
      }
    },

    async getPolicy() {
      return store.getPolicy(userId);
    },

    /**
     * Every chain, with the three facts the agent needs to propose a move:
     * the id to put in the intent, whether USDC can go there from the user's
     * Arc balance, and which token pays gas there once it lands.
     */
    async getSupportedChains() {
      return chainsOnNetwork().map((chain) => ({
        // What a proposal names it by. Ids stay out of the agent's hands.
        key: agentChainName(chain.id),
        name: chain.name,
        testnet: chain.testnet,
        canMoveUsdcHere: canMoveUsdcBetween(DEFAULT_CHAIN, chain.id),
        gasToken: chain.nativeCurrency.symbol,
        // Where stocks can be bought: every listed ticker, as a person says it.
        ...(chain.id === STOCK_CHAIN
          ? { stocks: STOCKS.map((stock) => ({ ticker: stock.symbol, name: stock.name, fund: stock.fund })) }
          : {}),
      }));
    },

    async listContacts() {
      return store.listContacts(userId);
    },

    async getTokenPrice(symbol) {
      try {
        const quote = await getTokenPriceUsd(symbol);
        return quote ?? { error: `No price available for ${symbol}.` };
      } catch {
        return { error: 'Price data is temporarily unavailable.' };
      }
    },

    /**
     * Preview an address or ENS name, for the agent to check before
     * `save_contact` — never an input to a transfer. Only the planner's own
     * resolution, inside `buildPlan`, is trusted for that.
     */
    async resolveAddress(input) {
      const trimmed = input.trim();

      const asAddress = AddressSchema.safeParse(trimmed);
      if (asAddress.success) {
        const ensName = await reader.lookupEns(asAddress.data).catch(() => null);
        return { address: asAddress.data, ensName };
      }

      if (!/^[^\s]{1,250}\.eth$/i.test(trimmed)) {
        return { error: 'Not a 0x address or an ENS name ending in .eth.' };
      }

      const address = await reader.resolveEns(trimmed.toLowerCase());
      if (!address) return { error: `Could not resolve ${trimmed}.` };

      return { address, ensName: trimmed.toLowerCase() };
    },

    async saveContact(label, address) {
      const parsed = AddressSchema.safeParse(address.trim());
      if (!parsed.success) {
        return { error: 'That is not a valid 0x address. Resolve it with resolve_address first.' };
      }

      await store.saveContact(userId, label, parsed.data);
      return { saved: true, label: label.trim(), address: parsed.data };
    },

    async deleteContact(label) {
      return { deleted: await store.deleteContact(userId, label) };
    },

    async getArcEcosystem() {
      try {
        return { protocols: await getArcProtocols() };
      } catch {
        return { error: 'Ecosystem data is temporarily unavailable.' };
      }
    },

    /**
     * A pasted contract, checked on every chain we can read at once: where it
     * exists, what it calls itself, and its price. Read-only; the names are
     * the deployer's and reach the agent fenced as untrusted.
     */
    async lookupToken(input) {
      const parsed = AddressSchema.safeParse(input.trim());
      if (!parsed.success) return { error: 'That is not a 0x contract address.' };
      const address = parsed.data;

      const chains = chainsOnNetwork().filter((chain) => !chain.gasPaidInUsdc && reader.supports(chain.id));
      const found = (
        await Promise.all(
          chains.map(async (chain) => {
            const metadata = await reader.tokenMetadata(chain.id, address).catch(() => null);
            return metadata ? { chain, metadata } : null;
          }),
        )
      ).filter((hit): hit is NonNullable<typeof hit> => hit !== null);

      if (found.length === 0) return { matches: [], note: 'No token at that address on any chain Blocky supports.' };

      const prices = await getTokenPricesByAddress(found.map(({ chain }) => ({ chainId: chain.id, address }))).catch(() => null);
      return {
        matches: found.map(({ chain, metadata }) => ({
          chain: agentChainName(chain.id),
          chainName: chain.name,
          symbol: metadata.symbol,
          name: metadata.name,
          decimals: metadata.decimals,
          priceUsd: prices?.get(`${chain.id}:${address}`)?.usd ?? null,
        })),
      };
    },

    async getProfile() {
      const user = await store.getUser(userId);
      return {
        username: await store.getUsername(userId),
        walletAddress: account,
        receiveOn: 'Arc — USDC sent to this address on Arc lands straight in their balance',
        ...(user ? {} : { note: 'Account still being set up.' }),
      };
    },

    async getNotifications() {
      const items = await store.listNotifications(userId, 20);
      return { unread: items.filter((item) => !item.read).length, items: items.map(({ title, body, read, createdAt }) => ({ title, body, read, at: createdAt })) };
    },

    async declineRequest(id) {
      const request = await store.getPaymentRequest(id);
      if (!request || request.status !== 'open') return { error: 'That request is no longer open.' };
      const status = request.requesterId === userId ? 'cancelled' : request.payerId === userId ? 'declined' : null;
      if (!status) return { error: 'That request is for someone else.' };
      await store.settleRequest(id, status);
      if (status === 'declined') {
        await store.notify(request.requesterId, {
          kind: 'request_declined',
          title: `${who(await store.getUsername(userId))} declined your request`,
          body: `${request.amountUsd} dollars${request.note ? ` for ${request.note}` : ''}`,
          data: { requestId: id },
        });
      }
      return { status };
    },

    async blockRequester(id) {
      const request = await store.getPaymentRequest(id);
      if (!request || request.payerId !== userId) return { error: 'That request was not made of them.' };
      await store.blockUser(userId, request.requesterId);
      return { blocked: request.requesterUsername ? `@${request.requesterUsername}` : 'that person' };
    },

    async deletePot(potName) {
      const pot = (await store.listPots(userId)).find((candidate) => candidate.name.toLowerCase() === potName.trim().toLowerCase());
      if (!pot) return { error: `There's no pot called "${potName}".` };
      await store.deletePot(userId, pot.id);
      return { deleted: pot.name, stillInWallet: pot.savedUsd };
    },

    /**
     * Only ever lower. A limit raised from a chat is a limit a clever message
     * could raise; raising stays on the Spending limits screen, in their hands.
     */
    async lowerSpendingLimits(limits) {
      const policy = await store.getPolicy(userId);
      const next = { ...policy };
      const refused: string[] = [];
      const read = (value: string | null) => {
        const clean = value?.trim().replace(/^\$/, '').replace(/,/g, '') ?? null;
        return clean !== null && /^\d+(\.\d{1,6})?$/.test(clean) ? clean : null;
      };

      const perSend = read(limits.perSendUsd);
      if (perSend !== null) {
        if (parseUsd(perSend) <= parseUsd(policy.perTxCapUsd)) next.perTxCapUsd = perSend;
        else refused.push('per send');
      }
      const perDay = read(limits.perDayUsd);
      if (perDay !== null) {
        if (parseUsd(perDay) <= parseUsd(policy.dailyCapUsd)) next.dailyCapUsd = perDay;
        else refused.push('per day');
      }

      await store.setPolicy(userId, next);
      return {
        perSendUsd: next.perTxCapUsd,
        perDayUsd: next.dailyCapUsd,
        ...(refused.length
          ? { notRaised: `Raising the limit ${refused.join(' and ')} has to be done on the Spending limits screen (Account → Spending limits).` }
          : {}),
      };
    },

    async requestMoney(input) {
      const result = await createRequest(store, userId, { payer: input.from, amountUsd: input.amountUsd, note: input.note });
      return result.ok ? { request: result.request, link: result.link, shareText: result.shareText } : { error: result.message };
    },

    async listRequests() {
      const { incoming, outgoing } = await store.listPaymentRequests(userId);
      const brief = (request: (typeof incoming)[number]) => ({
        id: request.id,
        from: who(request.requesterUsername),
        to: request.payerId ? who(request.payerUsername) : 'anyone with the link',
        amountUsd: request.amountUsd,
        note: request.note,
        status: request.status,
        // Asked by someone they've never dealt with — worth a word of caution.
        ...(request.fromStranger ? { fromSomeoneTheyDontKnow: true } : {}),
      });
      return { incoming: incoming.slice(0, 10).map(brief), outgoing: outgoing.slice(0, 10).map(brief) };
    },

    async setPriceAlert(alert) {
      const price = alert.priceUsd.trim().replace(/^\$/, '').replace(/,/g, '');
      if (!/^\d+(\.\d{1,6})?$/.test(price) || parseUsd(price) <= 0n) return { error: 'Give the price as a number of dollars.' };
      if (!(await getTokenPriceUsd(alert.symbol).catch(() => null))) {
        return { error: `There's no live price for ${alert.symbol} to watch.` };
      }
      return { alert: await store.addPriceAlert(userId, { symbol: alert.symbol, direction: alert.direction, thresholdUsd: price }) };
    },

    async listPriceAlerts() {
      return { alerts: await store.listPriceAlerts(userId) };
    },

    async cancelPriceAlert(id) {
      return { cancelled: await store.deletePriceAlert(userId, id) };
    },

    async getInsights(month) {
      const when = month && /^\d{4}-\d{2}$/.test(month) ? month : monthOf(new Date());
      return insightsFor(store, userId, account, when);
    },

    async setBudget(category, monthlyUsd) {
      if (!(BUDGET_CATEGORIES as readonly string[]).includes(category)) return { error: 'Budgets are for "people", "investing" or "total".' };
      const amount = monthlyUsd?.trim().replace(/^\$/, '') ?? null;
      if (amount !== null && !/^\d+(\.\d{1,6})?$/.test(amount)) return { error: 'Give the budget as a number of dollars.' };
      await store.setBudget(userId, category, amount);
      return { budgets: await store.listBudgets(userId) };
    },

    async listPots() {
      return { pots: await store.listPots(userId) };
    },

    async createPot(name, targetUsd) {
      const target = targetUsd?.trim().replace(/^\$/, '') ?? null;
      if (target !== null && !/^\d+(\.\d{1,6})?$/.test(target)) return { error: 'Give the goal as a number of dollars.' };
      return { pot: await store.createPot(userId, { name, targetUsd: target }) };
    },

    async moveToPot(potName, amountUsd) {
      const pot = (await store.listPots(userId)).find((candidate) => candidate.name.toLowerCase() === potName.trim().toLowerCase());
      if (!pot) return { error: `There's no pot called "${potName}".` };
      const raw = amountUsd.trim().replace('$', '');
      if (!/^-?\d+(\.\d{1,6})?$/.test(raw)) return { error: 'Give the amount in dollars, negative to take money out.' };
      const out = raw.startsWith('-');
      const units = parseUsd(raw.replace('-', ''));

      if (!out) {
        const [{ amount }, pots] = await Promise.all([readUsdcBalance(reader, DEFAULT_CHAIN, account), store.listPots(userId)]);
        const free = amount - pots.reduce((sum, p) => sum + parseUsd(p.savedUsd), 0n);
        if (units > free) return { error: `Only ${formatUsd(free > 0n ? free : 0n)} dollars aren't already in a pot.` };
      }
      return { pot: await store.adjustPot(userId, pot.id, out ? `-${formatUsd(units)}` : formatUsd(units)) };
    },

    async setUsername(name) {
      const result = await store.setUsername(userId, name);
      return result === 'ok'
        ? { username: await store.getUsername(userId) }
        : { error: result === 'taken' ? 'That name is taken.' : '3–20 letters, numbers or _, starting with a letter.' };
    },

    async remember(note) {
      return store.addMemory(userId, note);
    },

    async setAutoSave({ pot: potName, kind, percent, amountUsd, every }) {
      const pot = (await store.listPots(userId)).find((candidate) => candidate.name.toLowerCase() === potName.trim().toLowerCase());
      if (!pot) return { error: `There's no pot called "${potName}". Create it first.` };
      if ((await store.listSaveRules(userId)).length >= MAX_SAVE_RULES) {
        return { error: `At most ${MAX_SAVE_RULES} auto-saves. Stop one first.` };
      }

      const amount = amountUsd?.trim().replace(/^\$/, '') ?? null;
      const validAmount = amount !== null && /^\d+(\.\d{1,6})?$/.test(amount) && parseUsd(amount) > 0n;

      if (kind === 'percent_in') {
        if (percent === null || !Number.isInteger(percent) || percent < 1 || percent > 100) {
          return { error: 'Give the share as a whole percent, 1 to 100.' };
        }
        const rule = await store.addSaveRule(userId, { potId: pot.id, kind, percent, amountUsd: null, everyDays: null, nextRunAt: null });
        return { rule: describeRule(rule, pot.name) };
      }
      if (kind === 'recurring') {
        if (!validAmount) return { error: 'Give the amount in dollars, like "20".' };
        const everyDays = every === 'month' ? 30 : 7;
        // Starts now: "save $20 a week" puts the first $20 aside today.
        const rule = await store.addSaveRule(userId, {
          potId: pot.id,
          kind,
          percent: null,
          amountUsd: amount,
          everyDays,
          nextRunAt: new Date().toISOString(),
        });
        return { rule: describeRule(rule, pot.name) };
      }
      if (kind === 'sweep_above') {
        if (amount === null || !/^\d+(\.\d{1,6})?$/.test(amount)) return { error: 'Give the floor to keep free, in dollars.' };
        const rule = await store.addSaveRule(userId, { potId: pot.id, kind, percent: null, amountUsd: amount, everyDays: null, nextRunAt: null });
        return { rule: describeRule(rule, pot.name) };
      }
      return { error: 'Kind must be "percent_in", "recurring" or "sweep_above".' };
    },

    async listAutoSaves() {
      const [rules, pots] = await Promise.all([store.listSaveRules(userId), store.listPots(userId)]);
      const names = new Map(pots.map((pot) => [pot.id, pot.name]));
      return { rules: rules.map((rule) => describeRule(rule, names.get(rule.potId) ?? 'a pot')) };
    },

    async deleteAutoSave(id) {
      return { deleted: await store.deleteSaveRule(userId, id.trim()) };
    },

    // Theme lives on the phone. `createAgentHandler` overrides this to carry the
    // request back in the response; anywhere else there is no app to apply it.
    async setAppearance() {
      return { error: 'Appearance can only be changed from the app.' };
    },

    /** By the short id the agent sees — the first characters of the stored one. */
    async forgetMemory(id) {
      const wanted = id.trim().toLowerCase();
      const match = (await store.listMemories(userId)).find((memory) => memory.id.startsWith(wanted));
      return match && wanted.length >= 4
        ? { forgotten: await store.forgetMemory(userId, match.id) }
        : { forgotten: false, reason: 'No note with that id.' };
    },

    async getMarketOverview() {
      try {
        return await fetchMarketOverview();
      } catch {
        return { error: 'Market data is temporarily unavailable.' };
      }
    },

    /**
     * Reuses the same merge the Activity screen renders, so the agent's answer
     * about the past can never disagree with what the user sees when they look.
     */
    async getRecentActivity() {
      const [executions, transfers] = await Promise.all([
        store.listExecutions(userId, 20),
        explorerTransfers(account).then(
          (value) => ({ ok: true as const, value }),
          () => ({ ok: false as const, value: [] as ExplorerTransfer[] }),
        ),
      ]);

      return {
        items: mergeActivity(account, executions, transfers.value).slice(0, 20),
        complete: transfers.ok,
      };
    },
  };
}

/**
 * A prior chat turn, as text.
 *
 * The API is stateless, so the app sends recent history with each message.
 * Text only — tool calls and their results are not replayed, because they must
 * arrive in matched pairs and a client-supplied tool result is a forged one.
 *
 * History is client-controlled, so a user can put words in the agent's mouth.
 * That only reaches their own session, and every action it could lead to
 * still goes through the planner, the policy engine and their own fingerprint.
 */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentResponse {
  kind: AgentTurn['kind'] | 'plan';
  reply: string;
  /** The first plan — kept for clients that show one. Proposed, priced and checked, but not signed. */
  plan: Plan | null;
  /** What the policy engine says should happen to it. */
  decision: PolicyDecision | null;
  /**
   * Every plan in this reply, in order, each with its own decision: "bring
   * everything home" is one card per chain, approved together or one by one.
   */
  plans: Array<{ plan: Plan; decision: PolicyDecision }>;
  /** Plain-language note about what has and has not happened. */
  status: string;
  usage: AgentTurn['usage'];
  /** A theme the agent asked the app to switch to this turn. */
  appearance: 'light' | 'dark' | null;
}

export function createAgentHandler(
  store: Store,
  apiKey: string,
  reader: ChainReader,
  explorerTransfers: (address: Address) => Promise<ExplorerTransfer[]>,
  blockyFee: BlockyFeeTerms | null = null,
) {
  // One client for the process. Constructing per request throws away the
  // connection pool for no benefit.
  const client = new Anthropic({ apiKey });

  return async function handle(
    user: { id: string; walletAddress: Address },
    message: string,
    history: readonly ChatTurn[] = [],
    onActivity?: (label: string) => void,
  ): Promise<AgentResponse> {
    const userId = user.id;
    const account = user.walletAddress;

    // The planner runs inside the turn, so a refusal goes back to the model to
    // fix or explain — the user never reads a planner one-liner under a reply
    // that promised a card.
    const context = createPlannerContext({ reader, store, userId, account, blockyFee });
    // What Blocky remembers about them, with short ids to forget by.
    const memories = (await store.listMemories(userId).catch(() => [])).map((memory) => ({
      id: memory.id.slice(0, 8),
      note: memory.note,
    }));

    // Set by `set_appearance`; the app switches theme when the reply arrives.
    let appearance: 'light' | 'dark' | null = null;

    const turn = await runAgentTurn<Plan>(message, {
      memories,
      client,
      tools: {
        ...agentToolsFor(store, userId, reader, account, explorerTransfers),
        async setAppearance(mode) {
          appearance = mode;
          return { switched: true, appearance: mode };
        },
      },
      // News and "why did it move" need the web; a turn that searches can't propose.
      webSearch: true,
      testnet: IS_TESTNET,
      plan: async (intent) => {
        const mismatch = destinationMismatch(intent);
        if (mismatch) return { ok: false, message: mismatch };
        const outcome = await buildPlan(intent, context);
        return outcome.ok
          ? { ok: true, plan: await potWarning(store, reader, userId, account, outcome.plan) }
          : { ok: false, message: outcome.failure.message };
      },
      history: history.map((entry) => ({ role: entry.role, content: entry.content })),
      ...(onActivity ? { onActivity } : {}),
    });

    logUsage(turn);

    const empty = { plan: null, decision: null, plans: [], usage: turn.usage, appearance };

    switch (turn.kind) {
      case 'reply':
        return { ...empty, kind: turn.kind, reply: turn.text, status: 'ok' };

      case 'invalid_intent':
        return {
          ...empty,
          kind: turn.kind,
          reply: turn.text,
          status: `The agent could not produce a valid intent: ${turn.error}`,
        };

      case 'exhausted':
        return {
          ...empty,
          kind: turn.kind,
          reply: turn.text,
          status: 'The agent used its step budget without reaching an answer.',
        };

      case 'cannot_plan':
        // The model tried and kept getting refused. Its own words, if it had
        // any; the planner's reason otherwise.
        return { ...empty, kind: turn.kind, reply: turn.text || turn.reason, status: turn.reason };

      case 'intent':
        break;
    }

    /* --- Planned. Judge each against the user's limits. ------------------- */

    const [policy, spentToday] = await Promise.all([store.getPolicy(userId), store.spentTodayUsd(userId)]);

    // Judged as if the ones before it were sent too: two sends that each fit
    // today's limit may not fit it together.
    const plans: AgentResponse['plans'] = [];
    let spent = parseUsd(spentToday);
    for (const { plan } of turn.proposals) {
      const decision = evaluatePolicy({ policy, plan: plan!, spentTodayUsd: formatUsd(spent) });
      plans.push({ plan: plan!, decision });
      spent += plan!.outflow.reduce((sum, delta) => sum + (delta.usdValue ? parseUsd(delta.usdValue) : 0n), 0n);

      // Held so the client can approve it by id rather than posting a plan back —
      // a plan that arrives from a client is a plan an attacker can edit.
      await store.putPlan(userId, plan!, 'agent');
      // Paying someone who is asking them for that much settles their request.
      await linkMatchingRequest(store, userId, plan!).catch(() => {});
    }

    const first = plans[0]!;
    const unplanned = turn.unplanned.length ? ` Not included: ${turn.unplanned.join(' ')}` : '';

    return {
      kind: 'plan',
      appearance,
      reply: turn.text,
      plan: first.plan,
      decision: first.decision,
      plans,
      status: (plans.length > 1 ? `${plans.length} to approve.` : statusFor(first.decision)) + unplanned,
      usage: turn.usage,
    };
  };
}

function statusFor(decision: PolicyDecision): string {
  switch (decision.outcome) {
    case 'deny':
      return `Blocked by your settings: ${decision.reasons.map((r) => r.message).join(' ')}`;
    case 'require_confirmation':
      return 'Needs your approval.';
    case 'auto_execute':
      /*
       * Deliberately not "sending now". `auto_execute` means the plan cleared
       * the user's own limits, so the app offers it as a single tap instead of
       * a review screen — it does not mean the agent may sign. Nothing moves
       * money without the user's fingerprint, and that is a product boundary
       * rather than a missing feature: a key that can move funds on its own
       * would put us on the wrong side of the custody line.
       */
      return 'Within your limits — one tap to send.';
  }
}

/**
 * One line per chat message: what it cost and where the tokens went. The
 * model is the product's main running cost, so this is the number to watch —
 * a turn with no cache reads, or one that suddenly writes the whole prefix
 * again, shows up here first.
 */
function logUsage(turn: AgentTurn): void {
  const u = turn.usage;
  console.log(
    `agent ${turn.kind}: $${estimateCostUsd(u).toFixed(4)} · ${u.steps} step(s) · ` +
      `in ${u.inputTokens} · out ${u.outputTokens} · cache read ${u.cacheReadTokens} · cache write ${u.cacheWriteTokens}` +
      (u.webSearches > 0 ? ` · ${u.webSearches} web search(es)` : ''),
  );
}

/**
 * How a rationale may name each chain. "home" is Arc; "Base" only capitalised,
 * since "base" is an ordinary word.
 */
const CHAIN_MENTIONS: ReadonlyArray<[AgentChainName, RegExp]> = [
  ['arc', /\b(arc|home)\b/i],
  ['ethereum', /\b(ethereum|mainnet)\b/i],
  ['base', /\bBase\b/],
  ['arbitrum', /\barbitrum\b/i],
  ['optimism', /\b(optimism|OP mainnet)\b/i],
  ['polygon', /\bpolygon\b/i],
  ['unichain', /\bunichain\b/i],
  ['avalanche', /\b(avalanche|avax c-chain)\b/i],
  ['hyperevm', /\b(hyperevm|hyperliquid)\b/i],
  ['robinhood', /\brobinhood\b/i],
];

/**
 * The rationale is the agent's own account of what it means to do. When it
 * names chains and the destination it wrote isn't one of them, one of the two
 * is wrong — and it has been the number: "back to Arc" with Ethereum's id, and
 * money went to Ethereum. Refused before planning, so the agent fixes it and
 * the user never sees the wrong card.
 */
export function destinationMismatch(intent: Intent): string | null {
  if (intent.type !== 'bridge') return null;

  const named = CHAIN_MENTIONS.filter(([, pattern]) => pattern.test(intent.rationale)).map(([name]) => name);
  const destination = agentChainName(intent.toChainId);
  if (named.length === 0 || !destination || named.includes(destination)) return null;

  return `Your rationale names ${named.join(' and ')}, but the destination you set is ${destination}. One of them is wrong — fix it before proposing again.`;
}
