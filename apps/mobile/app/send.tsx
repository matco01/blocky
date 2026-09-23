import { isDecimalString, isPlanExpired, type Plan, type RecipientRef } from '@blocky/shared';
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
import { api } from '../lib/api';
import { useModalTopPadding } from '../lib/screenInsets';
import { confirmWithBiometrics } from '../lib/biometrics';
import { getHandedOffPlan, markPlanSent } from '../lib/handoff';
import { planAmountLabel, planDestinationLabel, planVerb } from '../lib/planLabels';
import { SubmittedButUnconfirmedError, useSmartAccount, type SendStage } from '../lib/smart-account';
import { font, useTheme } from '../theme';

type Step =
  | { name: 'form' }
  | { name: 'review'; plan: Plan }
  | { name: 'sending'; plan: Plan; stage: SendStage }
  | { name: 'done'; plan: Plan; recorded: boolean }
  /** Nothing reached the chain. Safe to try again. */
  | { name: 'failed'; plan: Plan; message: string }
  /** Submitted, outcome unknown. Never offer a retry: it could send twice. */
  | { name: 'unconfirmed'; plan: Plan };

const STAGE_COPY: Record<SendStage, string> = {
  preparing: 'Getting ready…',
  authorizing: 'Setting up your account — this happens once…',
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
  const { sendCalls, ready } = useSmartAccount();

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
  const [planning, setPlanning] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const secondsLeft = useSecondsLeft(step.name === 'review' ? step.plan.expiresAt : null);

  const recipient = parseRecipient(to);
  const amountValue = parseAmount(amount);

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
      const plan = await api.planSend(recipient, { kind: 'token', value: amountValue });
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

    let txHash: string;
    try {
      txHash = await sendCalls(plan.calls, (stage) => setStep({ name: 'sending', plan, stage }));
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
    const recorded = await reportWithRetry(plan.id, txHash);
    setStep({ name: 'done', plan, recorded });
  }

  /* Straight to the fingerprint for a plan the user's limits already cleared. */
  useEffect(() => {
    if (!autoSendPending.current) return;
    // The smart account has to be ready before anything can be signed.
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
            setAmount={setAmount}
            toError={to.length > 0 && !recipient ? 'Enter a 0x address, an ENS name, or a saved contact.' : null}
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
              {planAmountLabel(step.plan)} to {planDestinationLabel(step.plan)}
            </Text>
          </View>
        ) : null}

        {step.name === 'done' ? (
          <View style={styles.status}>
            <View style={[styles.check, { backgroundColor: theme.colors.accentTint, borderRadius: theme.radius.xl }]}>
              <Icon name="checkmark" size={36} tone="accent" />
            </View>
            <Text variant="title">{planVerb(step.plan) === 'Move' ? 'On its way' : 'Sent'}</Text>
            <Text variant="body" tone="secondary" style={styles.center}>
              {planAmountLabel(step.plan)} to {planDestinationLabel(step.plan)}
            </Text>
            {planVerb(step.plan) === 'Move' ? (
              <Text variant="caption" tone="tertiary" style={styles.center}>
                It usually lands within a minute.
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
  toError: string | null;
  formError: string | null;
}) {
  const theme = useTheme();

  return (
    <View style={{ gap: theme.space.xl }}>
      <ScreenHeader title="Send" onClose={() => router.back()} />

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

      <TextField
        label="To"
        value={props.to}
        onChangeText={props.setTo}
        placeholder="0x…, name.eth, or a contact"
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

/**
 * Tell the server about the transaction, retrying while it isn't visible yet.
 * Returns whether it was recorded. Never throws: the send already happened.
 */
async function reportWithRetry(planId: string, txHash: string): Promise<boolean> {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const result = await api.reportExecution(planId, txHash);
      if (result.confirmed) return true;
    } catch {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return false;
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
