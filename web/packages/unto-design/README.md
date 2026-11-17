# @unto/design

A sandbox design system for iterating on fonts, colors, sizes and component
styling. It started as a hard fork of `@thru/design` (tokens, web components,
brand assets and fonts) and is never synced back. Nothing ships with it: the
only consumer is its gallery, `web/unto-design-gallery`, deployed to
`https://unto-design.staging.web.5f1.net` (Cloudflare Access, staging
reviewers). It is a private workspace package and is never published.

```
unto-design/                  @unto/design
  tokens/   →  @unto/design/tokens/*.css   colors, type, space, radius, motion (plain CSS custom properties)
  web/      →  @unto/design/web            web components: Base UI behavior + plain CSS, dressed in the tokens
```

Import web components from `@unto/design/web` and the foundation CSS from
`@unto/design/web/styles.css` (or `@unto/design/tokens/css` for tokens alone).
There is no React Native implementation.

## Iterating

```bash
pnpm --filter unto-design-gallery dev   # http://localhost:5181
```

- **Colors**: ramps and semantic tokens in `tokens/src/tokens.css`; the
  dark-theme overrides in `tokens/src/neutral.css`.
- **Type**: the named scale (`.type-heading-*`, `.type-body-*`, …) in
  `tokens/src/typography.css`.
- **Fonts**: local variable fonts in `fonts/`, loaded by
  `web/src/next-fonts.ts` into `--font-inter-tight` / `--font-jetbrains-mono`.
- **Space, radius, motion**: the `--space-*`, `--radius-*`, `--duration-*`
  and `--ease-*` tokens in `tokens/src/tokens.css`.
- **Components**: `web/src/components/<Name>/<Name>.css`. Every value should
  read a `var(--token)`, so token edits restyle every component.

Merging to `main-thru` deploys the gallery.

## Fonts

Next.js apps import `interTight` and `jetbrainsMono` from
`@unto/design/web/next-fonts`. This subpath loads the Inter Tight and
JetBrains Mono variable fonts from `fonts/`, with normal and italic styles,
and sets `--font-inter-tight` and `--font-jetbrains-mono` through each
export's `variable` class.

## Principles

- **Behavior from Base UI, look from the tokens, styling in plain CSS.** No
  Tailwind in this package: components are styled with CSS that reads
  `var(--…)` token values. `tokens/theme.css` is an optional Tailwind v4 bridge.
- **Independent of `@thru/design`.** Change anything; nothing outside this
  package and its gallery imports it.

## Component conventions (`web/`)

Verified against [base-ui.com](https://base-ui.com) — these are the patterns we follow.

**From Base UI (do these):**

- **Compose the parts.** Build on Base UI's part anatomy (`Root`/`Trigger`/`Portal`/`Positioner`/`Popup`/`Item`…). Floating UI goes in `Portal` + `Positioner`.
- **Style state with `data-*` attributes** in plain CSS — Base UI's documented styling hook (`[data-open]`, `[data-popup-open]`, `[data-highlighted]`, `[data-selected]`, `[data-checked]`, `[data-disabled]`, `[data-starting-style]`/`[data-ending-style]` for enter/exit). `className` may also be a function of state; we keep logic in CSS.
- **`render` prop for polymorphism** (render a `Trigger` as our `Button`, an item as `<a>`, …). Custom render targets must forward `ref` and spread props.
- **Controlled/uncontrolled** pass straight through (`value`/`defaultValue`/`onValueChange`).

**Our layer (Base UI is unstyled + agnostic, so these are our choices):**

- **Plain CSS, `uds-` prefixed**, every value via `var(--token)`. (`uds-` keeps these classes apart from `@thru/design`'s `tds-`.)
- **Compound components → styled parts** (the shadcn-style approach; Base UI itself ships only raw parts). Re-export each Base UI part wrapped with its `uds-` class via `styledPart()` (`web/src/lib/styled.tsx`), preserving the compositional API:

  ```tsx
  <Dialog.Root>
    <Dialog.Trigger render={<Button />}>Open</Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Backdrop />
      <Dialog.Popup>…</Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>
  ```

- **Simple / data-driven primitives → closed wrappers** are fine (`Button`, `Card`, `Input`, the `items[]` `Select`, `Tag`, `Avatar`, `Spinner`).
- **One folder per component** (`<Name>/<Name>.tsx` + `<Name>.css`), co-located CSS imported by the `.tsx`, exported from `web/src/index.ts`. `tsc --noEmit` after each.

## Wallet surfaces (`web/src/components/wallet/`, `ConnectButton/`)

The web wallet iframe design, as composable parts (see the gallery's
"Wallet surfaces" section):

- `WalletOverlay` — light scrim + top-center island popup (Base UI `Dialog`,
  non-modal; 640 ms in / 480 ms out).
- `WalletSheet` — `Root` (the `Frame` chrome: site mark, label, verified
  badge, close) plus one part per screen: `SignIn`, `Loading`, `Permissions`,
  `Connected`, `Error`, `TxApprove`, `TxPending`, `TxDone`, `PoweredBy`.
- `Frame`, `Screen` (+ `Header`, `Box`, `Actions`), `Steps`, `Checklist`,
  `Details`, `TxTree` (nested collapsible review tree: `Section`, `Rows`,
  `Row`, `Hex`, `Account`, `Pre`, `Bytes`).
- `ConnectButton` — the dapp-side drop-in: idle / loading / connected chip
  with the account menu (manage, switch, add, explorer, sign out).
- `DepositButton` — the host's funding entry point ("Add funds" / "Adding
  funds…", optional trailing balance; `ghost` is the inline text-link form)
  that calls `thru.deposit()`.
- `Dove` — the animated mark that replaces a spinner after a 2 s wait;
  `ThruDisc`, `ThruWordmark`, `PoweredBy` brand marks.

## Brand assets (`assets/brand/`)

Files from the Thru Brand Guidelines (July 2025, v1.0), imported as
`@unto/design/assets/brand/<path>`. Names follow the guideline's color
labels. `brick` is `brick-400`. The guideline's `stone-*` ramp is close to
the `teal-*` tokens but not identical (stone-600 `#436465` vs teal-600
`#456063`).

- `avatars/` — the four approved social avatars (guidelines §2.8): the dove
  logomark on a disc. `avatar-brick` (800 px), `avatar-stone-0-brick`,
  `avatar-stone-600`, `avatar-stone-0-stone-600` (320 px). Use them only at
  small sizes, such as social profile icons. They are not for posters or
  banners.
- `logotype-outline.svg` — the outline logotype (§2.6): a brick wordmark with a
  stone-0 keyline. It is a secondary mark for large, expressive placements,
  such as banners, event posters and slide titles. It never replaces the
  primary logotype.
