import { useMemo } from 'react';
import { Platform, Text as RNText, StyleSheet, View, type TextStyle } from 'react-native';
import { parseMarkdown, type Inline } from '../../lib/markdown';
import { font, useTheme, type Theme } from '../../theme';
import { Text } from '../Text';

/**
 * The agent's reply, formatted.
 *
 * Paragraphs with room between them, lists with a hanging indent so wrapped
 * lines align with the text rather than the bullet, bold for the amount the
 * eye should land on, and addresses in a quiet monospace. Long-press to copy.
 */
export function RichText({ text, tone = 'primary' }: { text: string; tone?: 'primary' | 'secondary' }) {
  const theme = useTheme();
  const blocks = useMemo(() => parseMarkdown(text), [text]);

  return (
    <View style={{ gap: theme.space.md }}>
      {blocks.map((block, index) =>
        block.type === 'paragraph' ? (
          <Text key={index} variant="body" tone={tone} style={styles.body} selectable>
            <Spans inlines={block.inlines} theme={theme} />
          </Text>
        ) : (
          <View key={index} style={{ gap: theme.space.sm }}>
            {block.items.map((item, itemIndex) => (
              <View key={itemIndex} style={styles.item}>
                <Text variant="body" tone="tertiary" style={[styles.body, styles.marker]} tabular>
                  {block.ordered ? `${itemIndex + 1}.` : '•'}
                </Text>
                <Text variant="body" tone={tone} style={[styles.body, styles.itemText]} selectable>
                  <Spans inlines={item} theme={theme} />
                </Text>
              </View>
            ))}
          </View>
        ),
      )}
    </View>
  );
}

function Spans({ inlines, theme }: { inlines: Inline[]; theme: Theme }) {
  return (
    <>
      {inlines.map((span, index) => {
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

        return style.length > 0 ? (
          <RNText key={index} style={style}>
            {span.code ? ` ${span.text} ` : span.text}
          </RNText>
        ) : (
          span.text
        );
      })}
    </>
  );
}

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
  body: {
    lineHeight: 24,
  },
  item: {
    flexDirection: 'row',
  },
  marker: {
    width: 22,
  },
  itemText: {
    flex: 1,
  },
});
