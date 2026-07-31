# @thru/design/mobile

Thru Mobile design system for React Native / Expo apps — the mobile
implementation in `@thru/design`. Tokens and components are transcribed 1:1 from
the "Thru Mobile" Claude Design project (`design/thru-mobile.dc.html` is the
imported reference): Stone/Brick palette, Inter Tight + JetBrains Mono, square
radii, 4px grid, 44pt touch metrics.

Ships raw TypeScript source (Metro compiles workspace packages) — no build
step.

## Contents

- **`tokens`** — `palette`, semantic `color`, `text` type ramp (11→44pt),
  `font` family names, `touch` metrics (44pt hit / 52pt nav / 56pt tab+cell),
  `space`, `radius`
- **`theme`** — `ThemeProvider` / `useTheme` / `useThemeColors` /
  `makeStyles`, plus the `lightColors` and `darkColors` palettes
- **`Button`** — primary / brand / outline / outlineInverse / dangerOutline /
  ghost; sm/md/lg; loading
- **`Screen` / `NavBar` / `TabBar`** — screen chrome (`Screen` reserves bottom
  space only when `hasTabBar` is set; TabBar takes an `items` array; the brick
  indicator marks the active tab)
- **`Card` / `Cell` / `Badge` / `BalanceHero` / `Field` / `SectionLabel` /
  `StatusText`** — list rows, chips, the 44pt balance display
- **`Sheet`** — bottom sheet (scrim, 12pt top radius, 360ms slide)
- **`Icons`** — stroke icon set (`react-native-svg`)
- **`BrandMark`** — the Thru dove as a single vector path, tinted from the
  theme; `outline` strokes it instead of filling, and `BRAND_MARK_PATH` is
  exported so a loader can draw it on
- **`BrandWordmark`** — the horizontal lockup (red disc, dove, "thru"). Only
  the wordmark follows the theme; the disc is brand red and the dove sits on
  it, so both stay fixed. Pass `color` on an inverse surface — the sign-in
  button uses `fgInverse` so the wordmark flips with the button, not the screen
- **`BrandTile` / `WingsMark`** — the red wings lockup. `BrandTile` is the
  app-icon tile (brand-red field, wings knocked out) and deliberately keeps
  its brand colours in **both** themes; `radius={0}` squares it off for
  placement against kit chrome. `WingsMark` is the glyph alone, taking the
  theme foreground — trimmed to its true bounds by default, and see
  `WINGS_MARK_MIN_LEGIBLE_SIZE` before going small, because the feathers are
  negative space and close up below ~48pt
- **`SlotTicker` / `FlapDigits` / `MetaTable`** — split-flap chain readout for
  loading states. `FlapDigits` diffs against the previous value and only flips
  the characters that changed; `SlotTicker` renders a `null` slot as a
  placeholder rather than a fake zero; `MetaTable` is the hairline-ruled
  label/value row set and is useful well beyond loading. A live value must not
  update faster than `slotTickerSettleMs(cells)` (240ms for a six-cell number)
  — quicker than that interrupts flips before they finish and cells visibly
  fail to keep up
- **`ChannelStatus` / `MeterRow` / `SegmentBar`** — discrete-cell throughput
  meters for loading states. `SegmentBar` sweeps a band when indeterminate and
  latches cells when given `progress`; omitting a row's `readout` prints an
  em-dash, so a caller cannot accidentally render a latency of `0ms`

## Usage

```tsx
import { Button, Screen, NavBar, TabBar, color } from "@thru/design/mobile";
```

Peer deps: `react`, `react-native`, `react-native-svg`.

### Theming

Wrap the app once and every kit component follows the active theme:

```tsx
import { ThemeProvider } from "@thru/design/mobile";

<ThemeProvider preference={preference}>{children}</ThemeProvider>;
// preference: "light" | "dark" | "system"
```

App styles that need to follow the theme build their sheet with
`makeStyles`, which caches one `StyleSheet.create` per theme:

```tsx
const useStyles = makeStyles((c) => ({ row: { backgroundColor: c.bg } }));

function Row() {
  const styles = useStyles();
  return <View style={styles.row} />;
}
```

The flat `color` export is the light palette and stays for call sites that
do not need to switch — new code should prefer `makeStyles`/`useThemeColors`.

**Fonts are the app's responsibility** — the tokens only name families. Load
them once at the root (Expo):

```tsx
import { useFonts } from "expo-font";
import {
  InterTight_400Regular, InterTight_500Medium,
  InterTight_600SemiBold, InterTight_700Bold,
} from "@expo-google-fonts/inter-tight";
import {
  JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_600SemiBold,
} from "@expo-google-fonts/jetbrains-mono";
```

## Reference

`design/thru-mobile.dc.html` — the imported Claude Design project this kit
implements. Treat it as the design source of truth when extending the kit.
