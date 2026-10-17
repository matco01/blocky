import { useMemo } from 'react';
import { Platform, Text as RNText, StyleSheet, View, type TextStyle } from 'react-native';
import { parseMarkdown, type Block, type Inline } from '../../lib/markdown';
import { font, useTheme, type Theme } from '../../theme';
import { Icon } from '../Icon';
import { Text } from '../Text';

/**
 * The agent's reply, formatted.
 *
 * A short answer is just text. A longer one — a market recap, an explanation —
 * is built to be scanned rather than read: its opening line is the headline,
 * set larger; sections sit under small labels; bullets hang from a leaf-green
 * dot so wrapped lines align with the text; price moves are green or red so
 * the direction lands before the sentence does; and the sources sit quietly
 * at the foot. Addresses stay in a quiet monospace. Long-press to copy.
 */
export function RichText({ text, tone = 'primary' }: { text: string; tone?: 'primary' | 'secondary' }) {
  const theme = useTheme();
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const leadIndex = useMemo(() => leadOf(blocks), [blocks]);

  return (
    <View style={{ gap: theme.space.md }}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'paragraph':
            return (
              <Text
                key={index}
                variant="body"
                tone={tone}
                style={index === leadIndex ? styles.lead : styles.body}
                selectable
              >
                <Spans inlines={block.inlines} theme={theme} />
              </Text>
            );

          case 'heading':
            return (
              <View key={index} style={[styles.heading, index > 0 && { marginTop: theme.space.sm }]}>
                <View style={[styles.headingBar, { backgroundColor: theme.colors.accent }]} />
                <Text variant="label" tone="secondary" style={styles.headingText}>
                  <Spans inlines={block.inlines} theme={theme} />
                </Text>
              </View>
            );

          case 'source':
            return (
              <View key={index} style={[styles.source, { gap: theme.space.xs + 2 }]}>
                <Icon name="newspaper-outline" size={14} tone="tertiary" />
                <Text variant="caption" tone="tertiary" style={styles.sourceText} selectable>
                  <Spans inlines={block.inlines} theme={theme} />
                </Text>
              </View>
            );

          case 'list':
            return (
              <View key={index} style={{ gap: theme.space.sm + 2 }}>
                {block.items.map((item, itemIndex) => (
                  <View key={itemIndex} style={styles.item}>
                    <View style={styles.markerSlot}>
                      {block.ordered ? (
                        <View style={[styles.number, { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.sm }]}>
                          <Text variant="caption" tone="secondary" style={styles.numberText} tabular>
                            {itemIndex + 1}
                          </Text>
                        </View>
                      ) : (
                        <View style={[styles.dot, { backgroundColor: theme.colors.accent }]} />
                      )}
                    </View>
                    <Text variant="body" tone={tone} style={[styles.body, styles.itemText]} selectable>
                      <Spans inlines={item} theme={theme} />
                    </Text>
                  </View>
                ))}
              </View>
            );
        }
      })}
    </View>
  );
}

/**
 * The opening paragraph is the headline when the reply has structure under it
 * (a heading or a list) — and only when it's short enough to read as one. A
 * two-sentence answer stays plain text; a long first paragraph set large
 * would just be a bigger wall.
 */
function leadOf(blocks: Block[]): number {
  const first = blocks[0];
  if (first?.type !== 'paragraph') return -1;
  if (!blocks.some((block) => block.type === 'heading' || block.type === 'list')) return -1;
  const length = first.inlines.reduce((sum, span) => sum + span.text.length, 0);
  return length <= 180 ? 0 : -1;
}

function Spans({ inlines, theme }: { inlines: Inline[]; theme: Theme }) {
  return (
    <>
      {inlines.map((span, index) => {
        if (span.move) return <MovePill key={index} text={span.text} direction={span.move} theme={theme} />;

        const style: TextStyle[] = [];
        if (span.bold) style.push({ fontFamily: font.semibold, color: theme.colors.textPrimary, fontVariant: ['tabular-nums'] });
        if (span.italic) style.push({ fontStyle: 'italic' });
        if (span.code) {
          style.push({
            fontFamily: MONO,
            fontSize: 14,
            color: theme.colors.textSecondary,
            backgroundColor: theme.colors.surfaceMuted,
          });
        }
        if (style.length === 0) return span.text;

        // A tinted span gets a hair of room either side, so the fill doesn't
        // butt up against the letters.
        const padded = span.code ? ` ${span.text} ` : span.text;
        return (
          <RNText key={index} style={style}>
            {padded}
          </RNText>
        );
      })}
    </>
  );
}

/**
 * A price move as a small rounded pill, green up or red down.
 *
 * An inline view rather than a styled span: a text background can't be
 * rounded. A drop always shows its minus — "fell 2.1%" reads as "−2.1%" in
 * the pill, so the colour is never the only thing saying which way it went.
 */
function MovePill({ text, direction, theme }: { text: string; direction: 'up' | 'down'; theme: Theme }) {
  const up = direction === 'up';
  const label = up ? text : `−${text.replace(/^[-−]/, '')}`;

  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: up ? theme.colors.positiveTint : theme.colors.dangerTint, borderRadius: theme.radius.pill },
      ]}
    >
      <RNText style={[styles.pillText, { color: up ? theme.colors.positive : theme.colors.danger }]}>{label}</RNText>
    </View>
  );
}

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** The body line height; the bullet dot and number badge centre on its first line. */
const LINE = 24;
const DOT = 6;
const BADGE = 20;

const styles = StyleSheet.create({
  body: {
    lineHeight: LINE,
  },
  lead: {
    fontFamily: font.semibold,
    fontSize: 18,
    lineHeight: 26,
    letterSpacing: -0.2,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headingBar: {
    width: 3,
    height: 14,
    borderRadius: 2,
  },
  headingText: {
    flex: 1,
    fontFamily: font.bold,
    fontSize: 13,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  item: {
    flexDirection: 'row',
  },
  markerSlot: {
    width: 24,
    height: LINE,
    justifyContent: 'center',
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    marginLeft: 2,
  },
  number: {
    width: BADGE,
    height: BADGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberText: {
    fontSize: 12,
    lineHeight: 14,
  },
  itemText: {
    flex: 1,
  },
  pill: {
    paddingHorizontal: 7,
    paddingVertical: 1,
    // Inline views sit on the text's baseline; this drops the pill so it
    // centres on the line instead of riding above it.
    transform: [{ translateY: Platform.OS === 'android' ? 4 : 3 }],
  },
  pillText: {
    fontFamily: font.semibold,
    fontSize: 14,
    lineHeight: 18,
    fontVariant: ['tabular-nums'],
    ...Platform.select({ android: { includeFontPadding: false } }),
  },
  source: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  sourceText: {
    flex: 1,
  },
});
