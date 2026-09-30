/* Visual reference for the parts Deposit adds to the kit, every state side
   by side in either theme: the quote line's tones, the preset chips with and
   without a match, and the snackbar.

   Reference only, like BrandCheck.tsx: not exported and not mounted by any
   app. The sheet itself is the wallet-app's DepositFlow. */

import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import {
  PresetChips,
  QuoteLine,
  SectionLabel,
  Snackbar,
  ThemeProvider,
  font,
  makeStyles,
  space,
  text,
  touch,
  type ThemeName,
} from '../src';

const PRESETS = ['25', '50', '100', '250'].map((value) => ({ key: value, label: `$${value}` }));

export function DepositKitScreen() {
  const [theme, setTheme] = useState<ThemeName>('light');
  return (
    <ThemeProvider preference={theme}>
      <DepositKit theme={theme} onToggleTheme={setTheme} />
    </ThemeProvider>
  );
}

function DepositKit({
  theme,
  onToggleTheme,
}: {
  theme: ThemeName;
  onToggleTheme: (next: ThemeName) => void;
}) {
  const styles = useStyles();
  const [snackbarKey, setSnackbarKey] = useState(0);
  return (
    <ScrollView contentContainerStyle={styles.page} style={styles.root}>
      <Pressable
        accessibilityRole="button"
        onPress={() => onToggleTheme(theme === 'light' ? 'dark' : 'light')}
        style={styles.toggle}
      >
        <Text style={styles.toggleLabel}>Theme: {theme}</Text>
      </Pressable>

      <SectionLabel>QuoteLine</SectionLabel>
      <View style={styles.stack}>
        <QuoteLine message="Minimum $5" tone="subtle" />
        <QuoteLine message="You get $49.00 · fee $1.00" tone="muted" />
        <QuoteLine message="Getting a price…" tone="loading" />
        <QuoteLine message="Over the limit · $500 per purchase" tone="error" />
        <QuoteLine message="Couldn't get a price." onRetry={() => undefined} tone="error" />
      </View>

      <SectionLabel>PresetChips</SectionLabel>
      <View style={styles.stack}>
        <PresetChips onSelect={() => undefined} options={PRESETS} selectedKey={null} />
        <PresetChips onSelect={() => undefined} options={PRESETS} selectedKey="50" />
      </View>

      <SectionLabel>Snackbar</SectionLabel>
      <View style={styles.inset}>
        <Snackbar
          key={snackbarKey}
          message="$50.00 added."
          onDismiss={() => setSnackbarKey((key) => key + 1)}
          title="Added"
          tone="success"
        />
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  root: { backgroundColor: c.bg, flex: 1 },
  page: { gap: space[3], paddingVertical: space[5] },
  stack: { gap: space[4] },
  inset: { paddingHorizontal: touch.gutter },
  toggle: {
    alignSelf: 'flex-start',
    borderColor: c.borderStrong,
    borderWidth: 1,
    marginHorizontal: touch.screenX,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  toggleLabel: { color: c.fg, fontFamily: font.monoSemiBold, fontSize: text.sm },
}));
