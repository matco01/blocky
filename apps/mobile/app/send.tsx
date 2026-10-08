import { displayUsd, isDecimalString, isPlanExpired, type ChainId, type Plan, type RecipientRef } from '@blocky/shared';
import { DEFAULT_CHAIN, STOCK_CHAIN, getChain, stockBySymbol } from '@blocky/wallet-core';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { PlanReview } from '../components/PlanReview';
import { PressableScale } from '../components/PressableScale';
import { ScreenHeader } from '../components/ScreenHeader';
import { Text } from '../components/Text';
import { TextField } from '../components/TextField';
import { Tile } from '../components/Tile';
import { api } from '../lib/api';
import { reportWithRetry } from '../lib/report';
import { useModalTopPadding } from '../lib/screenInsets';
import { confirmWithBiometrics } from '../lib/biometrics';
import { getHandedOffPlan, markPlanSent } from '../lib/handoff';
import { planAmountLabel, planArrivalLabel, planDestinationLabel, planVerb } from '../lib/planLabels';
import { SubmittedButUnconfirmedError, useWallet, type SendResult, type SendStage } from '../lib/wallet';
import { font, useTheme } from '../theme';

type Step =
  | { name: 'form' }
  | { name: 'review'; plan: Plan }
  | { name: 'sending'; plan: Plan; stage: SendStage }
  | { name: 'done'; plan: Plan; recorded: boolean; extrasFailed: boolean }
  /** Nothing reached the chain. Safe to try again. */
  | { name: 'failed'; plan: Plan; message: string }
  /** Submitted, outcome unknown. Never offer a retry: it could send twice. */
  | { name: 'unconfirmed'; plan: Plan };

const STAGE_COPY: Record<SendStage, string> = {
  preparing: 'Getting ready…',
  submitting: 'Sending…',
  confirming: 'Confirming…',
};

/**
 * Send.
 *
 * form → review → fingerprint → sign → submit → done.
 *
 * The amount and recipient the user types go to the server, which plans the
 * send with the same planner the agent uses. The review card shows the
 * *server's* plan, and that plan — not the form — is what gets signed.
 *
 * A plan proposed in the chat arrives by id and starts at the review step.
 * This is the only screen that approves money, whoever proposed it.
 *
 * A plan the user's own limits already cleared arrives with `autosend` and goes
 * straight to the biometric prompt, skipping the review tap. That is a shortcut
 * through the *screen*, never through the approval: the prompt still names the
 * amount and the recipient, and nothing is signed without a fingerprint. The
 * user is the authority on every transfer either way — which is what keeps this
 * a wallet and not a custodian.
 */
export default function SendScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const topPadding = useModalTopPadding();
  const { sendCalls, ready } = useWallet();

  const { planId, autosend } = useLocalSearchParams<{ planId?: string; autosend?: string }>();
  const [handedOff] = useState(() => getHandedOffPlan(planId));

  /*
   * Fires once. If the user dismisses the fingerprint prompt we fall back to
   * the ordinary review screen rather than asking again — a prompt that
   * reappears on its own teaches people to approve without reading.
   */
  const autoSendPending = useRef(autosend === '1' && Boolean(handedOff));

  const [step, setStep] = useState<Step>(() =>
    handedOff ? { name: 'review', plan: handedOff } : { name: 'form' },
  );
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  // "Max" sends all of it, fees netted out by the planner — not a typed number
  // that goes stale or leaves dust behind.
  const [sendMax, setSendMax] = useState(false);
  const assets = useSendAssets(step.name === 'form');
  const [assetKey, setAssetKey] = useState<string | null>(null);
  const asset = assets?.find((a) => a.key === assetKey) ?? assets?.[0] ?? null;
  const [planning, setPlanning] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const secondsLeft = useSecondsLeft(step.name === 'review' ? step.plan.expiresAt : null);

  const recipient = parseRecipient(to);
  const amountValue = sendMax ? 'max' : parseAmount(amount);

  /** A fresh quote for the plan on screen. Keeps agent plans counted as agent plans. */
  async function requote(plan: Plan) {
    setPlanning(true);
    setApprovalError(null);
    try {
      setStep({ name: 'review', plan: await api.requotePlan(plan.id) });
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : 'Could not refresh that quote.');
    } finally {
      setPlanning(false);
    }
  }

  async function review() {
    if (!recipient || !amountValue) return;

    setPlanning(true);
    setFormError(null);
    try {
      // In dollars whatever the asset: "$20 of ETH" is how people think. The
      // planner converts at a real price, at the moment it plans.
      const plan = await api.planSend(
        recipient,
        amountValue === 'max' ? { kind: 'max' } : { kind: 'usd', value: amountValue },
        asset ? { symbol: asset.symbol, chainId: asset.chainId } : undefined,
      );
      setStep({ name: 'review', plan });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not prepare that send.');
    } finally {
      setPlanning(false);
    }
  }

  async function send(plan: Plan) {
    // A stale quote is re-quoted, never signed.
    if (isPlanExpired(plan)) {
      await requote(plan);
      return;
    }

    setApprovalError(null);
    const approval = await confirmWithBiometrics(`${planVerb(plan)} ${planAmountLabel(plan)}`);
    if (!approval.ok) {
      setApprovalError(approval.message);
      return;
    }

    setStep({ name: 'sending', plan, stage: 'preparing' });

    let result: SendResult;
    try {
      result = await sendCalls(plan.calls, {
        // Only a gas top-up may fail on its own; everything else moves the money.
        optionalLast: Boolean(plan.route?.gasTopUp),
        onStage: (stage) => setStep({ name: 'sending', plan, stage }),
      });
    } catch (error) {
      if (error instanceof SubmittedButUnconfirmedError) {
        setStep({ name: 'unconfirmed', plan });
        return;
      }
      // Failed before submission: nothing reached the chain, so a retry is safe.
      setStep({
        name: 'failed',
        plan,
        message: error instanceof Error ? error.message : 'The send did not go through. Nothing was sent.',
      });
      return;
    }

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (handedOff) markPlanSent(handedOff.id);

    /*
     * The money has moved. From here on nothing may say "failed": if reporting
     * to our server hiccups, the transfer still happened on-chain, and telling
     * the user otherwise invites them to send it again.
     */
    // Done the moment the chain says so. Recording it on our server can take a
    // while on a slow chain, and the user mustn't wait on our bookkeeping — it
    // carries on in the background, and the note only shows if it fails.
    setStep({ name: 'done', plan, recorded: true, extrasFailed: result.extrasFailed });
    void reportWithRetry(plan.id, result.hashes).then((recorded) => {
      if (!recorded) setStep((current) => (current.name === 'done' && current.plan.id === plan.id ? { ...current, recorded: false } : current));
    });
  }

  /* Straight to the fingerprint for a plan the user's limits already cleared. */
  useEffect(() => {
    if (!autoSendPending.current) return;
    // The wallet has to be ready before anything can be signed.
    if (!ready || step.name !== 'review') return;

    autoSendPending.current = false;
    void send(step.plan);
  }, [ready, step]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: theme.colors.background }}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: topPadding, paddingBottom: insets.bottom + theme.space.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {step.name === 'form' ? (
          <SendForm
            to={to}
            setTo={setTo}
            amount={amount}
            setAmount={(value) => {
              setSendMax(false);
              setAmount(value);
            }}
            sendMax={sendMax}
            onMax={() => {
              if (!asset?.usd) return;
              setSendMax(true);
              // What shows; "max" is what's sent, so rounding here costs nothing.
              setAmount(Number(asset.usd).toFixed(2));
            }}
            assets={assets}
            asset={asset}
            onPickAsset={(key) => {
              setAssetKey(key);
              setSendMax(false);
            }}
            toError={to.length > 0 && !recipient ? 'Enter an @name, a 0x address, an ENS name, or a saved contact.' : null}
            formError={formError}
          />
        ) : null}

        {step.name === 'review' ? (
          <View style={{ gap: theme.space.lg }}>
            <PlanReview plan={step.plan} secondsLeft={secondsLeft} />
            {approvalError ? (
              <Text variant="body" tone="warning" style={styles.center}>
                {approvalError}
              </Text>
            ) : null}
          </View>
        ) : null}

        {step.name === 'sending' ? (
          <View style={styles.status}>
            <Text variant="heading">{STAGE_COPY[step.stage]}</Text>
            <Text variant="body" tone="secondary">
              {planAmountLabel(step.plan)} {planDestinationLabel(step.plan)}
            </Text>
            {step.stage === 'confirming' && step.plan.calls[0] && step.plan.calls[0].chainId !== DEFAULT_CHAIN ? (
              <Text variant="caption" tone="tertiary" style={styles.center}>
                {getChain(step.plan.calls[0].chainId as ChainId).name} takes longer than Arc to confirm — usually under a minute.
              </Text>
            ) : null}
          </View>
        ) : null}

        {step.name === 'done' ? (
          <View style={styles.status}>
            <View style={[styles.check, { backgroundColor: theme.colors.accentTint, borderRadius: theme.radius.xl }]}>
              <Icon name="checkmark" size={36} tone="accent" />
            </View>
            <Text variant="title">{planVerb(step.plan) === 'Send' ? 'Sent' : 'On its way'}</Text>
            <Text variant="body" tone="secondary" style={styles.center}>
              {planAmountLabel(step.plan)} {planDestinationLabel(step.plan)}
            </Text>
            {planArrivalLabel(step.plan) ? (
              <Text variant="caption" tone="tertiary" style={styles.center}>
                {planArrivalLabel(step.plan)}.
              </Text>
            ) : null}
            {step.extrasFailed ? (
              <Text variant="caption" tone="warning" style={styles.center}>
                The gas top-up may not have gone through. Check Activity before trying it again.
              </Text>
            ) : null}
            {!step.recorded ? (
              <Text variant="caption" tone="tertiary" style={styles.center}>
                It may take a moment to appear in your activity.
              </Text>
            ) : null}
          </View>
        ) : null}

        {step.name === 'failed' ? (
          <View style={styles.status}>
            <View style={[styles.check, { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.xl }]}>
              <Icon name="alert-circle-outline" size={36} tone="secondary" />
            </View>
            <Text variant="title">Not sent</Text>
            <Text variant="body" tone="secondary" style={styles.center}>
              {step.message}
            </Text>
          </View>
        ) : null}

        {step.name === 'unconfirmed' ? (
          <View style={styles.status}>
            <View style={[styles.check, { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.xl }]}>
              <Icon name="time-outline" size={36} tone="secondary" />
            </View>
            <Text variant="title">Still confirming</Text>
            <Text variant="body" tone="secondary" style={styles.center}>
              Your send of {planAmountLabel(step.plan)} was submitted but is taking longer than usual to
              confirm. Check Activity in a minute before trying again, so you don't send it twice.
            </Text>
          </View>
        ) : null}

        <View style={{ gap: theme.space.md, marginTop: theme.space.xxl }}>
          {step.name === 'form' ? (
            <Button
              label="Review"
              disabled={!recipient || !amountValue || !ready}
              loading={planning}
              onPress={review}
            />
          ) : null}

          {step.name === 'review' ? (
            <>
              <Button
                label={secondsLeft === 0 ? 'Get a new quote' : `${planVerb(step.plan)} ${planAmountLabel(step.plan)}`}
                haptic={secondsLeft === 0 ? 'light' : 'heavy'}
                loading={planning}
                onPress={() => void send(step.plan)}
              />
              {handedOff ? (
                <Button label="Cancel" variant="quiet" onPress={() => router.back()} />
              ) : (
                <Button label="Edit" variant="quiet" onPress={() => setStep({ name: 'form' })} />
              )}
            </>
          ) : null}

          {step.name === 'done' || step.name === 'unconfirmed' ? (
            <Button label="Done" onPress={() => router.back()} />
          ) : null}

          {step.name === 'failed' ? (
            <>
              <Button label="Try again" onPress={() => setStep({ name: 'review', plan: step.plan })} />
              <Button label="Cancel" variant="quiet" onPress={() => router.back()} />
            </>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* -------------------------------------------------------------------------- */
/*  Steps                                                                      */
/* -------------------------------------------------------------------------- */

function SendForm(props: {
  to: string;
  setTo: (v: string) => void;
  amount: string;
  setAmount: (v: string) => void;
  sendMax: boolean;
  onMax: () => void;
  assets: SendAsset[] | null;
  asset: SendAsset | null;
  onPickAsset: (key: string) => void;
  toError: string | null;
  formError: string | null;
}) {
  const theme = useTheme();
  const [picking, setPicking] = useState(false);

  return (
    <View style={{ gap: theme.space.xl }}>
      <ScreenHeader title="Send" feature="leaf" subtitle="To a @name, a contact or an address." onClose={() => router.back()} />

      <View style={styles.amountBox}>
        <Text variant="balance" tone={props.amount ? 'primary' : 'tertiary'}>
          $
        </Text>
        <TextInput
          value={props.amount}
          onChangeText={(v) => props.setAmount(v.replace(/[^0-9.]/g, ''))}
          placeholder="0"
          placeholderTextColor={theme.colors.textTertiary}
          keyboardType="decimal-pad"
          autoFocus
          style={[styles.amountInput, { color: theme.colors.textPrimary }]}
        />
      </View>

      {/* What to send: everything the wallet holds, on every chain. */}
      {props.asset ? (
        <View style={{ gap: theme.space.sm }}>
          <Tile style={{ padding: theme.space.md }}>
            <View style={styles.assetRow}>
              <PressableScale
                onPress={() => setPicking((open) => !open)}
                accessibilityLabel="Choose what to send"
                style={[styles.assetRow, { flex: 1 }]}
              >
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{props.asset.name}</Text>
                  <Text variant="caption" tone="tertiary">
                    {props.asset.where}
                    {props.asset.usd ? ` · ${displayUsd(props.asset.usd)} available` : ''}
                  </Text>
                </View>
                <Icon name={picking ? 'chevron-up' : 'chevron-down'} size={18} tone="secondary" />
              </PressableScale>
              {props.asset.usd ? (
                <PressableScale onPress={props.onMax} accessibilityLabel="Send all of it" style={styles.maxChip}>
                  <Text variant="label" tone={props.sendMax ? 'primary' : 'accent'}>
                    Max
                  </Text>
                </PressableScale>
              ) : null}
            </View>
          </Tile>

          {picking
            ? (props.assets ?? []).map((choice) => (
                <PressableScale
                  key={choice.key}
                  onPress={() => {
                    props.onPickAsset(choice.key);
                    setPicking(false);
                  }}
                  accessibilityLabel={`Send ${choice.name} ${choice.where}`}
                >
                  <View style={[styles.assetRow, styles.assetChoice]}>
                    <View style={{ flex: 1 }}>
                      <Text variant="body" tone={choice.key === props.asset?.key ? 'accent' : 'primary'}>
                        {choice.name}
                      </Text>
                      <Text variant="caption" tone="tertiary">
                        {choice.where}
                      </Text>
                    </View>
                    <Text variant="body" tone="secondary">
                      {choice.usd ? displayUsd(choice.usd) : '—'}
                    </Text>
                  </View>
                </PressableScale>
              ))
            : null}

          {props.asset.chainId !== DEFAULT_CHAIN ? (
            <Text variant="caption" tone="tertiary">
              Sent on {getChain(props.asset.chainId as ChainId).name}: the person receives it there, and the fee is paid in{' '}
              {getChain(props.asset.chainId as ChainId).nativeCurrency.symbol}.
            </Text>
          ) : null}
        </View>
      ) : null}

      <TextField
        label="To"
        value={props.to}
        onChangeText={props.setTo}
        placeholder="@name, 0x…, name.eth, or a contact"
        autoCapitalize="none"
        autoCorrect={false}
        error={props.toError ?? props.formError}
        accessory={
          <PressableScale
            onPress={async () => props.setTo((await Clipboard.getStringAsync()).trim())}
            accessibilityLabel="Paste"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
          >
            <Icon name="copy-outline" size={16} tone="accent" />
            <Text variant="label" tone="accent">
              Paste
            </Text>
          </PressableScale>
        }
      />
    </View>
  );
}

/** Something the wallet can send: what it is, where it is, and what it's worth. */
interface SendAsset {
  key: string;
  symbol: string;
  chainId: number;
  /** "USDC", "ETH", "Apple". */
  name: string;
  /** "on Arc". */
  where: string;
  usd: string | null;
}

/**
 * What the wallet holds, as send choices: USDC on Arc first (what most sends
 * spend), then everything else by value. Null while loading, or if it can't be
 * read — the form still sends Arc USDC without it.
 */
function useSendAssets(active: boolean): SendAsset[] | null {
  const [assets, setAssets] = useState<SendAsset[] | null>(null);

  useEffect(() => {
    if (!active) return;
    let live = true;
    api
      .balance()
      .then((balance) => {
        if (!live) return;
        const home: SendAsset = {
          key: `${balance.chainId}-USDC`,
          symbol: 'USDC',
          chainId: balance.chainId,
          name: 'USDC',
          where: `on ${getChain(balance.chainId as ChainId).name}`,
          usd: balance.usdc.displayAmount,
        };
        const others = balance.otherHoldings
          .map((holding): SendAsset => {
            const stock = holding.chainId === STOCK_CHAIN ? stockBySymbol(holding.symbol) : null;
            return {
              key: `${holding.chainId}-${holding.symbol}`,
              symbol: holding.symbol,
              chainId: holding.chainId,
              name: stock ? stock.name : holding.symbol,
              where: `on ${getChain(holding.chainId as ChainId).name}`,
              usd: holding.usd,
            };
          })
          .sort((a, b) => Number(b.usd ?? 0) - Number(a.usd ?? 0));
        setAssets([home, ...others]);
      })
      .catch(() => {
        if (live) setAssets(null);
      });
    return () => {
      live = false;
    };
  }, [active]);

  return assets;
}

/**
 * Seconds until a quote expires, ticking once a second.
 *
 * Lives in the screen rather than the card so the button can switch to
 * "Get a new quote" the moment the quote lapses, not just the countdown text.
 */
function useSecondsLeft(expiresAt: string | null): number {
  const [seconds, setSeconds] = useState(() => (expiresAt ? secondsUntil(expiresAt) : 0));

  useEffect(() => {
    if (!expiresAt) return;
    setSeconds(secondsUntil(expiresAt));
    const timer = setInterval(() => setSeconds(secondsUntil(expiresAt)), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  return seconds;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function parseRecipient(input: string): RecipientRef | null {
  const value = input.trim();
  if (!value) return null;

  if (/^0x[0-9a-fA-F]{40}$/.test(value)) {
    return { kind: 'address', address: value.toLowerCase() as `0x${string}` };
  }
  // "@sam": another Blocky user, by name.
  if (/^@[a-zA-Z][a-zA-Z0-9_]{2,19}$/.test(value)) {
    return { kind: 'username', username: value.slice(1).toLowerCase() };
  }
  if (/^[^\s]{1,250}\.eth$/i.test(value)) {
    return { kind: 'ens', name: value.toLowerCase() };
  }
  // Anything that looks like a mistyped address is an error, not a contact
  // name — a label "0x12ab" would silently fail to resolve on the server.
  if (value.toLowerCase().startsWith('0x')) return null;
  if (value.length <= 64) return { kind: 'contact', label: value };

  return null;
}

/** A positive USDC amount with at most 6 decimal places, or null. */
function parseAmount(input: string): string | null {
  const value = input.trim();
  if (!isDecimalString(value)) return null;
  if ((value.split('.')[1]?.length ?? 0) > 6) return null;
  if (/^0(\.0*)?$/.test(value)) return null;
  return value;
}

function secondsUntil(iso: string): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000));
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
  },
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 96,
  },
  assetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  assetChoice: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  maxChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  amountInput: {
    fontFamily: font.extrabold,
    fontSize: 48,
    minWidth: 60,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  status: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    minHeight: 320,
  },
  check: {
    width: 76,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  center: {
    textAlign: 'center',
  },
});
