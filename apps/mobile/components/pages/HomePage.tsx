import { usePrivy } from '@privy-io/expo';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, ScrollView, StyleSheet, View, type TextInput } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { displayUsd } from '@blocky/shared';
import { ActionButton } from '../ActionButton';
import { BalanceDisplay } from '../BalanceDisplay';
import { ChatEmpty, type Capability } from '../chat/ChatEmpty';
import { ChatInput } from '../chat/ChatInput';
import { ChatPlanCard } from '../chat/ChatPlanCard';
import { AssistantMessage, ErrorMessage, UserMessage } from '../chat/Messages';
import { TypingIndicator } from '../chat/TypingIndicator';
import { Mascot } from '../Mascot';
import { PageDots, type PageProps } from '../PageDots';
import { PressableScale } from '../PressableScale';
import { Text } from '../Text';
import { ApiError, api } from '../../lib/api';
import { useChat } from '../../lib/chat';
import { handOffPlan, useSentPlans } from '../../lib/handoff';
import { useKeyboardVisible } from '../../lib/keyboard';
import { useTheme } from '../../theme';

type BalanceState =
  | { state: 'loading' }
  | { state: 'setting-up' }
  | { state: 'ready'; balance: string }
  | { state: 'error'; message: string; lastBalance: string | null };

/** How often the balance refreshes while Home is on screen, so incoming money shows up. */
const BALANCE_POLL_MS = 20_000;

/**
 * Home — the first page of the pager.
 *
 * The balance, three shortcuts, and the chat. The chat is the main surface:
 * anything more involved than a plain send is something you say, not somewhere
 * you navigate to. Account and settings are one swipe to the left.
 */
export function HomePage({ page, onPageChange }: PageProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { logout } = usePrivy();

  const [balance, setBalance] = useState<BalanceState>({ state: 'loading' });
  const lastBalance = useRef<string | null>(null);
  const [focused, setFocused] = useState(true);

  const { messages, busy, send, retry } = useChat();
  const isSent = useSentPlans();
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const [draft, setDraft] = useState('');
  const typing = useKeyboardVisible();

  const pickCapability = useCallback(
    (capability: Capability) => {
      if (capability.action.kind === 'send') {
        send(capability.action.text);
      } else {
        setDraft(capability.action.text);
        inputRef.current?.focus();
      }
    },
    [send],
  );

  const fetchBalance = useCallback(async () => {
    try {
      const result = await api.balance();
      lastBalance.current = result.totalUsd;
      setBalance({ state: 'ready', balance: result.totalUsd });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'wallet_not_ready') {
        setBalance({ state: 'setting-up' });
        return;
      }
      // Keep the last known number on screen. A spinner that never resolves, or
      // a zero, both say something false about the user's money.
      setBalance({
        state: 'error',
        message: error instanceof Error ? error.message : 'Something went wrong.',
        lastBalance: lastBalance.current,
      });
    }
  }, []);

  // Refresh whenever Home comes back into view — most importantly, after a send.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void fetchBalance();
      return () => setFocused(false);
    }, [fetchBalance]),
  );

  // Poll while visible, faster while the wallet is still being created.
  useEffect(() => {
    if (!focused) return;
    const interval = balance.state === 'setting-up' ? 2000 : BALANCE_POLL_MS;
    const timer = setInterval(() => void fetchBalance(), interval);
    return () => clearInterval(timer);
  }, [focused, balance.state, fetchBalance]);

  function confirmSignOut() {
    Alert.alert('Sign out?', 'You can sign back in with your email.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void logout() },
    ]);
  }

  const shown =
    balance.state === 'ready' ? balance.balance : balance.state === 'error' ? (balance.lastBalance ?? '0') : '0';
  const canTransact = balance.state === 'ready' || (balance.state === 'error' && balance.lastBalance !== null);

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      {/* --- Top: header, balance, shortcuts ------------------------------- */}
      <View
        style={[
          styles.top,
          { paddingTop: insets.top + theme.space.sm, paddingBottom: typing ? theme.space.sm : theme.space.lg },
        ]}
      >
        <View style={styles.header}>
          <Text variant="bodyStrong">Blocky</Text>
          <View style={styles.dots} pointerEvents="box-none">
            <PageDots page={page} onPageChange={onPageChange} />
          </View>
          {typing ? (
            // While typing the big balance is folded away; keep the number in view.
            <Animated.View entering={FadeIn.duration(180)}>
              <Text variant="bodyStrong" tone="secondary" tabular>
                {displayUsd(shown)}
              </Text>
            </Animated.View>
          ) : (
            <PressableScale onPress={confirmSignOut} accessibilityLabel="Sign out" haptic="none">
              <Text variant="label" tone="tertiary">
                Sign out
              </Text>
            </PressableScale>
          )}
        </View>

        {/* Folded away while typing, so the conversation gets the screen. */}
        {typing ? null : (
          <Animated.View entering={FadeIn.duration(220)} style={styles.topBody}>
            <BalanceDisplay
              totalUsd={shown}
              loading={balance.state === 'loading' || balance.state === 'setting-up'}
              onPress={() => void fetchBalance()}
            />

            {balance.state === 'setting-up' ? (
              <Text variant="caption" tone="tertiary" style={styles.center}>
                Setting up your wallet…
              </Text>
            ) : null}
            {balance.state === 'error' ? (
              <Text variant="caption" tone="warning" style={styles.center}>
                {balance.lastBalance === null ? balance.message : `${balance.message} Showing your last known balance.`}
              </Text>
            ) : null}

            <View style={[styles.actions, { gap: theme.space.sm, marginTop: theme.space.lg }]}>
              <ActionButton
                label="Receive"
                glyph="↓"
                fill="accent"
                disabled={!canTransact}
                onPress={() => router.push('/receive')}
              />
              <ActionButton
                label="Send"
                glyph="↑"
                fill="secondary"
                disabled={!canTransact}
                onPress={() => router.push('/send')}
              />
              <ActionButton label="Activity" glyph="≡" onPress={() => router.push('/activity')} />
            </View>
          </Animated.View>
        )}
      </View>

      <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />

      {/*
       * Blocky himself — a presence you're talking to, not a contact-header
       * avatar. Pinned above the chat, never inside the ScrollView, so he
       * stays put as the conversation grows rather than scrolling away.
       * Shrinks while typing, the same fold the balance above uses, so the
       * keyboard never has to fight him for room.
       */}
      <Animated.View layout={LinearTransition.duration(180)} style={styles.mascotRow}>
        <Mascot pose="happy" size={typing ? 44 : 104} />
      </Animated.View>

      {/* --- Chat ---------------------------------------------------------- */}
      <ScrollView
        ref={scrollRef}
        style={styles.chat}
        // Wider gaps between turns than within them, so each exchange reads as a unit.
        contentContainerStyle={[styles.chatContent, { gap: theme.space.xl }]}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        // The visible area shrinks when the keyboard opens; keep the latest message in view.
        onLayout={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {messages.length === 0 && !busy ? (
          <ChatEmpty onPick={pickCapability} />
        ) : (
          messages.map((message) => {
            switch (message.role) {
              case 'user':
                return <UserMessage key={message.id} text={message.text} />;

              case 'error':
                return <ErrorMessage key={message.id} text={message.text} onRetry={() => retry(message.id)} />;

              case 'assistant': {
                const plan = message.plan;
                return (
                  <AssistantMessage key={message.id} text={message.text} note={message.note}>
                    {plan ? (
                      <ChatPlanCard
                        plan={plan}
                        decision={message.decision}
                        sent={isSent(plan.id)}
                        onReview={() => {
                          handOffPlan(plan);
                          router.push({ pathname: '/send', params: { planId: plan.id } });
                        }}
                      />
                    ) : null}
                  </AssistantMessage>
                );
              }
            }
          })
        )}

        {busy ? <TypingIndicator /> : null}
      </ScrollView>

      <View
        style={{
          paddingHorizontal: theme.space.lg,
          paddingTop: theme.space.sm,
          // The navigation-bar inset only applies when the keyboard is down;
          // with it up, it is just a gap between the input and the keys.
          paddingBottom: typing ? theme.space.sm : insets.bottom + theme.space.sm,
        }}
      >
        <ChatInput value={draft} onChangeText={setDraft} onSend={send} busy={busy} inputRef={inputRef} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  top: {
    paddingHorizontal: 20,
    gap: 8,
  },
  topBody: {
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: 32,
  },
  // Centred on the screen regardless of what sits either side of it.
  dots: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  mascotRow: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 8,
  },
  chat: {
    flex: 1,
  },
  chatContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
});
