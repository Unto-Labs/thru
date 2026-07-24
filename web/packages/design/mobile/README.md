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
- **`Button`** — primary / brand / outline / outlineInverse / dangerOutline /
  ghost; sm/md/lg; loading
- **`Screen` / `NavBar` / `TabBar`** — screen chrome (`Screen` reserves bottom
  space only when `hasTabBar` is set; TabBar takes an `items` array; the brick
  indicator marks the active tab)
- **`Card` / `Cell` / `Badge` / `BalanceHero` / `Field` / `SectionLabel` /
  `StatusText`** — list rows, chips, the 44pt balance display
- **`Sheet`** — bottom sheet (scrim, 12pt top radius, 360ms slide)
- **`Icons`** — stroke icon set (`react-native-svg`)

## Usage

```tsx
import { Button, Screen, NavBar, TabBar, color } from "@thru/design/mobile";
```

Peer deps: `react`, `react-native`, `react-native-svg`.

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
