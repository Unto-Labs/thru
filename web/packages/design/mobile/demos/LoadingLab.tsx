/* Prototype gallery for the competing loading-screen directions
   (specs/passkey-demo-loading-screen-proposals.md), so a reviewer can compare
   them on a device without a wallet, a passkey, or a live RPC. Each prototype
   drives itself on a loop; nothing here talks to the chain.

   Reference only: not exported from @thru/design/mobile and not mounted by
   any app. It was the wallet-app's `/loading-lab` route until UNTO-2916 took
   review screens out of the app; render `LoadingLabScreen` from a host to use
   it. */

import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  NavBar,
  Screen,
  Segmented,
  ThemeProvider,
  font,
  makeStyles,
  space,
  text,
  touch,
  type ThemeName,
} from '../src';
import { HairlineGridPrototype } from './HairlineGridPrototype';
import { MarkDrawOnPrototype } from './MarkDrawOnPrototype';
import { SlotTickerPrototype } from './SlotTickerPrototype';
import { ThroughputMeterPrototype } from './ThroughputMeterPrototype';

type LabKey = 'slot' | 'grid' | 'meter' | 'mark';

const OPTIONS = [
  { label: 'SLOT', value: 'slot' },
  { label: 'GRID', value: 'grid' },
  { label: 'METER', value: 'meter' },
  { label: 'MARK', value: 'mark' },
] as const satisfies readonly { label: string; value: LabKey }[];

const CAPTIONS: Record<LabKey, string> = {
  slot: '1 — Slot Ticker',
  grid: '2 — Hairline Grid',
  meter: '3 — Throughput Meter',
  mark: '4 — Mark Draw-On',
};

function Prototype({ active }: { active: LabKey }) {
  switch (active) {
    case 'grid':
      return <HairlineGridPrototype />;
    case 'meter':
      return <ThroughputMeterPrototype />;
    case 'mark':
      return <MarkDrawOnPrototype />;
    default:
      return <SlotTickerPrototype />;
  }
}

/* A host that pins `userInterfaceStyle: "light"` in app.json, as the wallet-app
   does, bakes it into Info.plist, so `useColorScheme()` can never return dark
   and the usual `preference: "system"` leaves the device permanently light. An
   explicit preference overrides that, so the lab carries its own switch — it
   is the only way to review these directions in dark without an app.json
   change and a native rebuild. */
export function LoadingLabScreen() {
  const [theme, setTheme] = useState<ThemeName>('light');
  return (
    <ThemeProvider preference={theme}>
      <LoadingLab theme={theme} onToggleTheme={setTheme} />
    </ThemeProvider>
  );
}

function LoadingLab({
  theme,
  onToggleTheme,
}: {
  theme: ThemeName;
  onToggleTheme: (next: ThemeName) => void;
}) {
  const styles = useStyles();
  const [active, setActive] = useState<LabKey>('slot');

  return (
    <Screen scroll={false}>
      <NavBar
        title="Loading lab"
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
      <View style={styles.picker}>
        <Segmented
          accessibilityLabel="Loading screen direction"
          options={OPTIONS}
          value={active}
          onChange={setActive}
        />
        <Text style={styles.caption}>{CAPTIONS[active]}</Text>
      </View>
      {/* Keyed so switching directions remounts the prototype and restarts
          its cycle from frame zero instead of resuming mid-loop. */}
      <View style={styles.stage}>
        <Prototype key={active} active={active} />
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((c) => ({
  themeToggle: {
    color: c.fgMuted,
    fontFamily: font.monoSemiBold,
    fontSize: text.xxs,
    letterSpacing: 0.8,
  },
  picker: {
    gap: space[2],
    paddingHorizontal: touch.screenX,
    paddingVertical: space[3],
  },
  caption: {
    color: c.fgSubtle,
    fontFamily: font.mono,
    fontSize: text.xxs,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  stage: {
    borderTopColor: c.border,
    borderTopWidth: 1,
    flex: 1,
  },
}));
