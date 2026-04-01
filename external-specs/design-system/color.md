# Color System

The Thru color system provides a cohesive palette that balances industrial precision with warmth and accessibility.

## Contents

1. [Color Scales](#color-scales)
2. [Semantic Tokens](#semantic-tokens)
3. [Status Colors](#status-colors)
4. [Dark Mode](#dark-mode)
5. [Usage Guidelines](#usage-guidelines)

---

## Color Scales

### Steel (Cool Neutral)

A cool gray scale for neutral UI elements and backgrounds.

| Token | Hex | Usage |
|-------|-----|-------|
| `steel-0` | `#f7f8f8` | Lightest backgrounds |
| `steel-100` | `#eaeef0` | Light backgrounds |
| `steel-200` | `#cdd5db` | Borders, dividers |
| `steel-300` | `#a4b3bc` | Disabled text |
| `steel-400` | `#7e93a0` | Placeholder text |
| `steel-500` | `#5b6f7b` | Secondary text |
| `steel-600` | `#43515b` | Dark text on light |
| `steel-700` | `#2b353b` | Darker backgrounds |
| `steel-800` | `#151b1e` | Darkest backgrounds |

### Teal (Warm Neutral)

A warm teal-tinted neutral scale for primary surfaces and text.

| Token | Hex | Usage |
|-------|-----|-------|
| `teal-0` | `#f9fbfb` | Elevated surfaces |
| `teal-100` | `#eaf2f2` | Primary surfaces |
| `teal-200` | `#d1e1e1` | Lower surfaces, borders |
| `teal-300` | `#a9c3c5` | Subtle borders |
| `teal-400` | `#81a7a7` | Secondary borders |
| `teal-500` | `#5e8787` | Muted text |
| `teal-600` | `#456063` | Secondary text |
| `teal-700` | `#2d3e3e` | Dark surfaces |
| `teal-800` | `#151e1e` | Darkest surfaces |

### Brick (Primary Brand)

The primary brand color—a distinctive coral/salmon red.

| Token | Hex | Usage |
|-------|-----|-------|
| `brick-100` | `#fbdadc` | Light accent backgrounds |
| `brick-200` | `#f6acb0` | Default brick (brand) |
| `brick-300` | `#ed787e` | Hover states |
| `brick-400` | `#d33c43` | Strong emphasis, errors |

### Sky (Blue)

Information and link colors.

| Token | Hex | Usage |
|-------|-----|-------|
| `sky-100` | `#cfeffc` | Info backgrounds |
| `sky-200` | `#8cd4f2` | Light accents |
| `sky-300` | `#28a3d7` | Links |
| `sky-400` | `#0279b1` | Strong emphasis |

### Grass (Green)

Success and confirmation states.

| Token | Hex | Usage |
|-------|-----|-------|
| `grass-100` | `#c2ebe8` | Success backgrounds |
| `grass-200` | `#75d1cc` | Light success |
| `grass-300` | `#239f97` | Success icons |
| `grass-400` | `#0a766f` | Strong success |

### Yellow (Warning)

Warning and pending states.

| Token | Hex | Usage |
|-------|-----|-------|
| `yellow-100` | `#fdefdd` | Warning backgrounds |
| `yellow-200` | `#fde0ba` | Light warning |
| `yellow-300` | `#fbc784` | Warning icons |
| `yellow-400` | `#ffad42` | Strong warning |

### Tan/Sand (Accent)

Warm neutral accents.

| Token | Hex | Usage |
|-------|-----|-------|
| `tan-100` | `#f6ebe5` | Subtle backgrounds |
| `tan-200` | `#ebd5c7` | Light accents |
| `tan-300` | `#ddb8a0` | Medium accents |
| `tan-400` | `#c98f69` | Strong accents |

### Golden (Focus)

Special highlight color for focus states.

| Token | Hex | Usage |
|-------|-----|-------|
| `golden` | `#ffffbd` | Focus backgrounds, highlights |

---

## Semantic Tokens

Semantic tokens abstract color usage from specific values, enabling consistent theming and easier dark mode support.

### Text Colors

| Token | Light Mode Value | Usage |
|-------|------------------|-------|
| `text-primary` | `steel-800` | Primary content |
| `text-secondary` | `teal-600` | Secondary content |
| `text-tertiary` | `steel-400` | Tertiary/muted |
| `text-brand` | `brick-400` | Brand emphasis |
| `text-disabled` | `steel-300` | Disabled state |

**Inverse (on dark backgrounds):**

| Token | Value | Usage |
|-------|-------|-------|
| `text-primary-inverse` | `teal-0` | Primary text on dark |
| `text-secondary-inverse` | `teal-200` | Secondary on dark |
| `text-tertiary-inverse` | `teal-400` | Tertiary on dark |
| `text-disabled-inverse` | `steel-600` | Disabled on dark |

### Surface Colors

| Token | Light Mode Value | Usage |
|-------|------------------|-------|
| `surface-higher` | `teal-0` | Elevated cards, modals |
| `surface-primary` | `teal-100` | Main page background |
| `surface-lower` | `teal-200` | Recessed areas, inputs |
| `surface-disabled` | `steel-100` | Disabled surfaces |

**Inverse:**

| Token | Value | Usage |
|-------|-------|-------|
| `surface-higher-inverse` | `teal-600` | Elevated on dark |
| `surface-primary-inverse` | `teal-700` | Primary dark surface |
| `surface-lower-inverse` | `steel-800` | Darkest surface |

**Brand Surfaces:**

| Token | Value | Usage |
|-------|-------|-------|
| `surface-brick` | `brick-400` | Brand CTAs |
| `surface-sky` | `sky-400` | Info emphasis |
| `surface-grass` | `grass-400` | Success emphasis |
| `surface-yellow` | `yellow-400` | Warning emphasis |

### Border Colors

| Token | Light Mode Value | Usage |
|-------|------------------|-------|
| `border-primary` | `teal-800` | Strong borders |
| `border-secondary` | `teal-400` | Standard borders |
| `border-tertiary` | `teal-200` | Subtle borders |
| `border-brand` | `brick-400` | Brand borders, focus |
| `border-disabled` | `steel-300` | Disabled borders |

---

## Status Colors

Consistent color coding for system states.

### Success

```tsx
// Badge
<span className="bg-grass-100 text-grass-400">Confirmed</span>

// Result card
<div className="bg-teal-500/10 border border-teal-500/30">
  <CheckCircle className="text-teal-500" />
</div>
```

### Pending/Warning

```tsx
// Badge
<span className="bg-yellow-100 text-yellow-400">Pending</span>

// Alert
<div className="bg-yellow-100 border border-yellow-300">
  Warning message
</div>
```

### Error/Failed

```tsx
// Badge
<span className="bg-brick-100 text-brick-400">Failed</span>

// Error card
<div className="bg-brick-500/10 border border-brick-500/30">
  <XCircle className="text-brick-500" />
</div>
```

### Info

```tsx
// Badge
<span className="bg-sky-100 text-sky-400">Info</span>

// Notice
<div className="bg-sky-100 border border-sky-300">
  Information message
</div>
```

---

## Dark Mode

The design system uses semantic tokens with inverse variants for dark mode support.

### Surface Hierarchy (Light vs Dark)

| Level | Light Mode | Dark Mode |
|-------|------------|-----------|
| Higher (elevated) | `teal-0` | `teal-600` |
| Primary | `teal-100` | `teal-700` |
| Lower (recessed) | `teal-200` | `steel-800` |

### Implementation

```tsx
// Using inverse classes for dark surfaces
<header className="bg-surface-lower-inverse">
  <span className="text-text-primary-inverse">Logo</span>
</header>

// Full dark mode (future)
<div className="dark:bg-surface-primary-inverse dark:text-text-primary-inverse">
  Content adapts to dark mode
</div>
```

---

## Usage Guidelines

### Do's

1. **Use semantic tokens** for UI colors
   ```tsx
   // Good
   <p className="text-text-secondary">Description</p>

   // Avoid
   <p className="text-teal-600">Description</p>
   ```

2. **Maintain contrast ratios**
   - Normal text: 4.5:1 minimum
   - Large text/UI: 3:1 minimum

3. **Use status colors consistently**
   - Green/Grass = Success, confirmed
   - Yellow = Warning, pending
   - Red/Brick = Error, failed
   - Blue/Sky = Info, links

4. **Pair backgrounds with appropriate text**
   ```tsx
   // Light surface + dark text
   <div className="bg-surface-higher text-text-primary" />

   // Dark surface + light text (inverse)
   <div className="bg-surface-lower-inverse text-text-primary-inverse" />
   ```

### Don'ts

1. **Don't use color alone for meaning**
   ```tsx
   // Bad: Color-only indicator
   <div className="w-2 h-2 bg-grass-400 rounded-full" />

   // Good: Color + icon + text
   <StatusBadge kind="success">
     <CheckIcon /> Confirmed
   </StatusBadge>
   ```

2. **Don't mix color scales arbitrarily**
   - Stick to teal neutrals for primary UI
   - Use steel for secondary/disabled states
   - Reserve brand colors for emphasis

3. **Don't override semantic tokens with raw values**
   ```tsx
   // Bad
   <Button className="bg-surface-brick text-white" />

   // Good
   <Button className="bg-surface-brick text-text-primary-inverse" />
   ```

### Color in Components

| Component | Primary Color | Secondary | Hover/Focus |
|-----------|--------------|-----------|-------------|
| Button (primary) | `surface-lower-inverse` | `text-primary-inverse` | `surface-higher-inverse` |
| Button (secondary) | `surface-brick` | `text-primary-inverse` | 90% opacity |
| Button (outline) | `border-primary` | `text-primary` | `surface-lower` |
| Input | `surface-higher` | `border-secondary` | `golden` background |
| Card | `surface-higher` or white | `border-secondary` | — |
| Badge (success) | `grass-100` | `grass-400` | — |
| Badge (error) | `brick-100` | `brick-400` | — |
