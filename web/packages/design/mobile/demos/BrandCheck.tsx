/* Visual reference for the brand marks in @thru/design/mobile. The marks are
   easiest to judge at several sizes side by side on a real device, and
   `WingsMark` in particular has a size floor (its feathers are negative space
   and close up when filled small) that only shows up when you can compare.

   Reference only, like LoadingLab.tsx: not exported and not mounted by any
   app. It was the wallet-app's `/brand-check` route until UNTO-2916. */

import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  BrandMark,
  BrandTile,
  BrandWordmark,
  NavBar,
  Screen,
  SectionLabel,
  ThemeProvider,
  WingsMark,
  font,
  makeStyles,
  space,
  text,
  touch,
  type ThemeName,
} from '../src';

/* Same reason as the loading lab: a host that pins `userInterfaceStyle` to
   light never reports dark, so an explicit preference is the only way to see
   these in dark on a device. The marks are exactly where a theme mistake would
   hide. */
export function BrandCheckScreen() {
  const [theme, setTheme] = useState<ThemeName>('light');
  return (
    <ThemeProvider preference={theme}>
      <BrandCheck theme={theme} onToggleTheme={setTheme} />
    </ThemeProvider>
  );
}

function BrandCheck({
  theme,
  onToggleTheme,
}: {
  theme: ThemeName;
  onToggleTheme: (next: ThemeName) => void;
}) {
  const styles = useStyles();
  return (
    <Screen>
      <NavBar
        title="Brand marks"
        right={
          <Pressable
            accessibilityLabel={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => onToggleTheme(theme === 'light' ? 'dark' : 'light')}
          >
            <Text style={styles.themeToggle}>
              {theme === 'light' ? 'LGT' : 'DRK'}
            </Text>
          </Pressable>
        }
      />
      <View style={styles.page}>
        <SectionLabel>BrandWordmark — horizontal lockup</SectionLabel>
        <View style={styles.row}>
          <View style={styles.item}>
            <BrandWordmark size={40} />
            <Text style={styles.label}>40 default</Text>
          </View>
          <View style={styles.item}>
            <BrandWordmark size={24} />
            <Text style={styles.label}>24</Text>
          </View>
        </View>
        <View style={styles.onInverse}>
          <BrandWordmark size={24} color={styles.inverseProbe.color} />
          <Text style={styles.inverseLabel}>on bgInverse (color=fgInverse)</Text>
        </View>

        <SectionLabel>BrandTile — red lockup</SectionLabel>
        <View style={styles.row}>
          <View style={styles.item}>
            <BrandTile size={96} />
            <Text style={styles.label}>96 default</Text>
          </View>
          <View style={styles.item}>
            <BrandTile size={64} />
            <Text style={styles.label}>64</Text>
          </View>
          <View style={styles.item}>
            <BrandTile size={40} />
            <Text style={styles.label}>40</Text>
          </View>
          <View style={styles.item}>
            <BrandTile size={64} radius={0} />
            <Text style={styles.label}>square</Text>
          </View>
        </View>

        <SectionLabel>WingsMark — monochrome glyph</SectionLabel>
        <View style={styles.row}>
          <View style={styles.item}>
            <WingsMark size={72} />
            <Text style={styles.label}>trimmed</Text>
          </View>
          <View style={styles.item}>
            <WingsMark size={72} untrimmed />
            <Text style={styles.label}>untrimmed</Text>
          </View>
          <View style={styles.item}>
            <BrandMark size={72} />
            <Text style={styles.label}>dove (existing)</Text>
          </View>
          <View style={styles.item}>
            <BrandMark size={72} outline />
            <Text style={styles.label}>dove outline</Text>
          </View>
        </View>
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((c) => ({
  page: {
    gap: space[4],
    padding: touch.screenX,
  },
  row: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[4],
  },
  item: {
    alignItems: 'center',
    gap: space[2],
  },
  label: {
    color: c.fgSubtle,
    fontFamily: font.mono,
    fontSize: text.xxs,
  },
  themeToggle: {
    color: c.fgMuted,
    fontFamily: font.monoSemiBold,
    fontSize: text.xxs,
    letterSpacing: 0.8,
  },
  onInverse: {
    alignItems: 'center',
    backgroundColor: c.bgInverse,
    gap: space[2],
    padding: space[4],
  },
  inverseLabel: {
    color: c.fgInverse,
    fontFamily: font.mono,
    fontSize: text.xxs,
    opacity: 0.7,
  },
  /* Carries fgInverse to the wordmark as a value, since BrandWordmark takes a
     colour string rather than a style. */
  inverseProbe: {
    color: c.fgInverse,
  },
}));
