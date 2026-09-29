import { displayUsd, formatUsd, parseUsd, planOutflowUsd, type Address } from '@blocky/shared';
import type { Pot, SaveRule, Store } from './store';

/**
 * Auto-save and the weekly check-in: the two things Blocky does on his own.
 *
 * Auto-save moves no money. Pots are envelopes over the wallet, so a rule only
 * shifts dollars from "free" into a pot's envelope — never more than is free,
 * and never past a pot's goal. That is why it may run unattended: the worst a
 * wrong rule does is mislabel money that stays in the user's own wallet.
 */

/** How often the sweep runs. A percent rule sees money a few minutes after it lands. */
export const AUTOSAVE_CHECK_MS = 5 * 60_000;

/** The check-in scan runs hourly; each user still gets at most one a week. */
export const CHECK_IN_SCAN_MS = 60 * 60_000;
const WEEK_MS = 7 * 24 * 60 * 60_000;

/** The USDC a wallet holds, in the same 6-decimal units as `parseUsd`. */
export type BalanceOf = (address: Address) => Promise<bigint>;

export async function runAutoSave(store: Store, balanceOf: BalanceOf, now = new Date()): Promise<number> {
  const rules = await store.listAllSaveRules();
  const byUser = new Map<string, SaveRule[]>();
  for (const rule of rules) byUser.set(rule.userId, [...(byUser.get(rule.userId) ?? []), rule]);

  let saved = 0;
  for (const [userId, userRules] of byUser) {
    try {
      saved += await saveForUser(store, balanceOf, userId, userRules, now);
    } catch (error) {
      // One user's bad read must not stop everyone else's savings.
      console.error('auto-save failed for a user', error);
    }
  }
  return saved;
}

async function saveForUser(store: Store, balanceOf: BalanceOf, userId: string, rules: SaveRule[], now: Date): Promise<number> {
  const user = await store.getUser(userId);
  if (!user) return 0;

  const balance = await balanceOf(user.walletAddress);
  const pots = new Map((await store.listPots(userId)).map((pot) => [pot.id, pot]));
  let free = balance - [...pots.values()].reduce((sum, pot) => sum + parseUsd(pot.savedUsd), 0n);
  let applied = 0;

  for (const rule of rules) {
    const pot = pots.get(rule.potId);
    if (!pot) continue;

    let want = 0n;
    if (rule.kind === 'percent_in') {
      // Money arrived if the wallet grew since the last look. The baseline moves
      // every time — down after a send too — so nothing is counted twice.
      const last = rule.lastBalanceUsd === null ? null : parseUsd(rule.lastBalanceUsd);
      await store.updateSaveRule(rule.id, { lastBalanceUsd: formatUsd(balance) });
      if (last !== null && balance > last) want = ((balance - last) * BigInt(rule.percent ?? 0)) / 100n;
    } else if (rule.kind === 'sweep_above') {
      const floor = parseUsd(rule.amountUsd ?? '0');
      if (free > floor) want = free - floor;
    } else if (rule.kind === 'recurring') {
      if (!rule.nextRunAt || new Date(rule.nextRunAt) > now) continue;
      want = parseUsd(rule.amountUsd ?? '0');
      const next = new Date(new Date(rule.nextRunAt).getTime() + (rule.everyDays ?? 7) * 24 * 60 * 60_000);
      await store.updateSaveRule(rule.id, { nextRunAt: next.toISOString() });
      if (want > free) {
        await store.notify(userId, {
          kind: 'auto_save',
          title: `Couldn't set aside ${displayUsd(formatUsd(want))} for ${pot.name}`,
          body: `Only ${displayUsd(formatUsd(free > 0n ? free : 0n))} was free. Blocky will try again next time.`,
          data: { potId: pot.id },
        });
        continue;
      }
    }

    const amount = capped(want, free, pot);
    if (amount <= 0n) continue;

    const updated = await store.adjustPot(userId, pot.id, formatUsd(amount));
    if (!updated) continue;
    pots.set(pot.id, updated);
    free -= amount;
    applied += 1;
    await store.updateSaveRule(rule.id, { savedSinceCheckInUsd: formatUsd(parseUsd(rule.savedSinceCheckInUsd) + amount) });

    if (updated.targetUsd && parseUsd(updated.savedUsd) >= parseUsd(updated.targetUsd) && parseUsd(pot.savedUsd) < parseUsd(updated.targetUsd)) {
      await store.notify(userId, {
        kind: 'pot_goal',
        title: `${pot.name} is full!`,
        body: `You hit your ${displayUsd(updated.targetUsd)} goal. Happy little sprout moment.`,
        data: { potId: pot.id },
      });
    }
  }
  return applied;
}

/** Never more than is free, and never past a pot's goal. */
function capped(want: bigint, free: bigint, pot: Pot): bigint {
  let amount = want < free ? want : free;
  if (pot.targetUsd) {
    const room = parseUsd(pot.targetUsd) - parseUsd(pot.savedUsd);
    if (amount > room) amount = room;
  }
  return amount > 0n ? amount : 0n;
}

/**
 * The weekly check-in: a short note in the user's notifications about their
 * week. Written from their data by template — no model call, so it costs
 * nothing — and skipped entirely for a quiet week.
 */
export async function runCheckIns(store: Store, now = new Date()): Promise<number> {
  let sent = 0;
  for (const user of await store.listUsers()) {
    try {
      if (now.getTime() - new Date(user.createdAt).getTime() < WEEK_MS) continue;
      const last = await store.lastNotificationAt(user.id, 'check_in');
      if (last && now.getTime() - new Date(last).getTime() < WEEK_MS) continue;
      if (await checkIn(store, user, now)) sent += 1;
    } catch (error) {
      console.error('check-in failed for a user', error);
    }
  }
  return sent;
}

async function checkIn(store: Store, user: { id: string; walletAddress: Address }, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - WEEK_MS);
  const [moves, received, pots, rules] = await Promise.all([
    store.listSettledMoves(user.id, since),
    store.listReceivedFromUsers(user.walletAddress, since),
    store.listPots(user.id),
    store.listSaveRules(user.id),
  ]);

  const sentUsd = moves.reduce((sum, move) => sum + parseUsd(planOutflowUsd(move.plan) ?? '0'), 0n);
  const receivedUsd = received.reduce((sum, entry) => sum + parseUsd(entry.usd), 0n);
  const autoSaved = rules.reduce((sum, rule) => sum + parseUsd(rule.savedSinceCheckInUsd), 0n);

  const lines: string[] = [];
  if (sentUsd > 0n) lines.push(`You sent ${displayUsd(formatUsd(sentUsd))}.`);
  if (receivedUsd > 0n) lines.push(`Friends paid you ${displayUsd(formatUsd(receivedUsd))}.`);
  if (autoSaved > 0n) lines.push(`Auto-save put ${displayUsd(formatUsd(autoSaved))} aside.`);
  const goal = pots.find((pot) => pot.targetUsd && parseUsd(pot.savedUsd) < parseUsd(pot.targetUsd));
  if (goal) lines.push(`${goal.name}: ${displayUsd(goal.savedUsd)} of ${displayUsd(goal.targetUsd!)}.`);

  // A quiet week gets no note: a check-in about nothing teaches people to ignore them.
  if (lines.length === 0) return false;

  await store.notify(user.id, {
    kind: 'check_in',
    title: 'Your week with Blocky',
    body: `${lines.join(' ')} Rooting for you.`,
    data: { since: since.toISOString() },
  });
  await Promise.all(rules.map((rule) => store.updateSaveRule(rule.id, { savedSinceCheckInUsd: '0' })));
  return true;
}
