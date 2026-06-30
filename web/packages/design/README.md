# @thru/design

The Thru design system, split by platform so a single set of design decisions
can drive web and (later) native surfaces.

One package, `@thru/design`, with per-platform subpath exports:

```
design/                       @thru/design
  tokens/   →  @thru/design/tokens      platform-neutral source of truth (colors, type, space, radius, motion)
  web/      →  @thru/design/web         web components: Base UI behavior + plain CSS, dressed in the tokens
  mobile/   →  @thru/design/mobile      (future) React Native implementation, consumes the same tokens
```

Import paths: components from `@thru/design/web`, the token TS object from
`@thru/design/tokens`, and the foundation CSS via `@thru/design/web/styles.css`
(or `@thru/design/tokens/css` for tokens alone).

## Principles

- **Tokens are the only shared artifact.** Components cannot be shared across web
  and React Native (Base UI is DOM-only; RN has no DOM/CSS). So the contract that
  keeps platforms in sync is the **token set** plus a **shared component API**
  (same names, same props/variants), not shared component code.
- **Aesthetic canon = [`thru-web`](https://github.com/Unto-Labs/thru-web).** The
  color, semantic, and type tokens here are lifted verbatim from `thru-web`'s
  `globals.css` (which `@thru/design-system` already matched byte-for-byte).
  Structural primitives (spacing scale, radius, motion, detailed type tokens)
  are adopted from the `thru-design` Base UI gallery, which formalized them.
- **Behavior from Base UI, look from the tokens, styling in plain CSS.** No
  Tailwind in this package — components are styled with CSS that reads
  `var(--…)` token values.

## Token reconciliation (how the three sources resolved)

| Concern | thru-web (canon) | thru-design | Resolution |
|---|---|---|---|
| Neutrals | `steel-*`, `teal-*` | `stone-*` | Use steel/teal; drop stone |
| Accents | `sky, grass, yellow, tan, sand` | `ocean, forest, saffron, sand` | Use thru-web's; drop ocean/forest/saffron |
| `sand` | `300=#ddb8a0 400=#c98f69` | swapped | Use thru-web's order |
| Brick | `100–400` | `100–500` | thru-web's 100–400 (brick-500 dropped) |
| Type scale | `.type-heading/body/ui/button-*` | numeric `text-*` | Use thru-web's named scale |
| Spacing / radius / motion | — (none) | `--space/-radius/-duration/-ease-*` | Adopt from thru-design (additive) |
| Fonts | Inter Tight + JetBrains Mono | same | Unchanged |

## Component conventions (`web/`)

Verified against [base-ui.com](https://base-ui.com) — these are the patterns we follow.

**From Base UI (do these):**

- **Compose the parts.** Build on Base UI's part anatomy (`Root`/`Trigger`/`Portal`/`Positioner`/`Popup`/`Item`…). Floating UI goes in `Portal` + `Positioner`.
- **Style state with `data-*` attributes** in plain CSS — Base UI's documented styling hook (`[data-open]`, `[data-popup-open]`, `[data-highlighted]`, `[data-selected]`, `[data-checked]`, `[data-disabled]`, `[data-starting-style]`/`[data-ending-style]` for enter/exit). `className` may also be a function of state; we keep logic in CSS.
- **`render` prop for polymorphism** (render a `Trigger` as our `Button`, an item as `<a>`, …). Custom render targets must forward `ref` and spread props.
- **Controlled/uncontrolled** pass straight through (`value`/`defaultValue`/`onValueChange`).

**Our layer (Base UI is unstyled + agnostic, so these are our choices):**

- **Plain CSS, `tds-` prefixed**, every value via `var(--token)`. (`tn-` collides with app-local classes.)
- **Compound components → styled parts** (the shadcn-style approach; Base UI itself ships only raw parts). Re-export each Base UI part wrapped with its `tds-` class via `styledPart()` (`web/src/lib/styled.tsx`), preserving the compositional API:

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

CSS is ported from thru-design's `app.css` class families, retargeted to the canonical tokens.
