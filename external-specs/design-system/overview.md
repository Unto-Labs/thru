# Thru Design System Specification

A comprehensive design system for building consistent, accessible, and beautiful Thru-branded applications across web and mobile platforms.

## Document Structure

| Section | Description |
|---------|-------------|
| [Foundations](./foundations.md) | Core principles, accessibility, layout systems |
| [Color](./color.md) | Color palette, semantic tokens, usage guidelines |
| [Typography](./typography.md) | Type scale, font families, text styles |
| [Spacing](./spacing.md) | Spacing scale, layout grids, sizing |
| [Components](./components.md) | UI component specifications |
| [Patterns](./patterns.md) | Common UI patterns and layouts |

---

## Overview

The Thru Design System provides a unified visual language and component library for all Thru applications:

| Application | URL | Purpose |
|-------------|-----|---------|
| Marketing | thru.org | Information and onboarding |
| Scanner | scan.thru.org | Blockchain explorer |
| Wallet | wallet.thru.org | Web wallet application |
| DEX | dex.thru.org | Decentralized exchange |
| Mint | mint.thru.org | Token creation |

---

## Design Philosophy

### 1. Industrial Precision

Thru's visual identity draws from industrial and mechanical aesthetics—precision engineering, reliability, and clarity.

**Characteristics:**
- Clean geometric shapes with sharp edges
- **Sharp corners on ALL UI elements** (no `rounded-*` classes)
- Structured grid-based layouts
- Consistent spacing rhythms (4px base unit)
- Purposeful borders over soft shadows
- Monospace typography for technical/blockchain data

**MANDATORY: No Rounded Corners**

All buttons, cards, inputs, badges, and containers must have sharp (90°) corners. This is non-negotiable and defines the Thru brand identity.

| Element | Allowed | NOT Allowed |
|---------|---------|-------------|
| Buttons | Sharp corners | `rounded-*`, `rounded-full` |
| Cards | Sharp corners | `rounded-lg`, `rounded-xl` |
| Inputs | Sharp corners | `rounded-md` |
| Badges | Sharp corners | `rounded-full` (pill shape) |
| Containers | Sharp corners | Any border-radius |

**Exceptions (require explicit justification):**
- Token/coin icons (circular by convention)
- Avatar images (circular is acceptable)
- Spinner/loading indicators (circular motion)

**Visual References:**
- Pressure gauges and industrial instruments
- Blueprint and schematic drawings
- Mechanical precision tooling
- Factory and workshop aesthetics

### 2. Transparent Trust

Blockchain technology demands transparency. Interfaces must clearly communicate state, provide honest feedback, and never hide important information.

**Characteristics:**
- Explicit status indicators (success/pending/failed)
- Visible loading and error states
- Clear transaction confirmations
- Honest empty states ("No data" vs hidden)
- Progressive disclosure of complexity

### 3. Accessible Performance

Every user should interact with Thru applications quickly and efficiently, regardless of device, connection speed, or ability.

**Characteristics:**
- WCAG 2.1 AA compliant
- Keyboard navigable interfaces
- Minimum 44px touch targets
- Fast initial load times
- Skeleton loading states

---

## Technology Stack

### Core Technologies

| Technology | Version | Purpose |
|------------|---------|---------|
| Tailwind CSS | v4 | Utility-first CSS |
| React | 18+ | Component framework |
| Next.js | 14+ | Application framework |
| TypeScript | 5+ | Type safety |

### Package: @thru/design-system

```bash
pnpm add @thru/design-system
```

**Structure:**
```
@thru/design-system/
├── src/
│   ├── tailwind.css      # Design tokens (CSS variables)
│   ├── components/       # React components
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Input.tsx
│   │   └── Text.tsx
│   └── utils.ts          # Utilities (cn, classNames)
└── dist/                 # Built output
```

**Integration:**
```css
/* globals.css */
@import "tailwindcss";
@import "@thru/design-system/tailwind.css";

@source "../node_modules/@thru/design-system/src";
```

---

## Design Tokens

Design tokens are the atomic values that define the visual language. All tokens are defined as CSS custom properties in `tailwind.css`.

### Token Categories

| Category | Prefix | Example |
|----------|--------|---------|
| Color scales | `--color-{scale}-{shade}` | `--color-steel-500` |
| Semantic colors | `--color-{role}-{variant}` | `--color-text-primary` |
| Typography | `--text-{role}-{size}` | `--text-headline-xl` |
| Spacing | `--spacing-{size}` | via Tailwind utilities |
| Breakpoints | `--breakpoint-{size}` | `--breakpoint-md` |

### Token Usage

Always prefer semantic tokens over raw color scales:

```tsx
// Preferred: Semantic token
<div className="text-text-primary bg-surface-higher" />

// Avoid: Raw color scale
<div className="text-steel-800 bg-teal-0" />
```

---

## Breakpoints

| Name | Width | Target Devices |
|------|-------|----------------|
| `sm` | 600px | Mobile landscape, small tablets |
| `md` | 840px | Tablets |
| `lg` | 1200px | Desktops |
| `xl` | 1600px | Large displays |

**Usage:**
```tsx
<div className="
  px-4           /* Base: mobile */
  sm:px-6        /* ≥600px */
  md:px-8        /* ≥840px */
  lg:px-12       /* ≥1200px */
">
```

---

## Quick Reference

### Common Patterns

```tsx
// Page container
<main className="container mx-auto px-4 sm:px-6 md:px-8 max-w-7xl">

// Card with border
<Card variant="default" className="p-4">

// Primary button
<Button variant="primary" size="md">Action</Button>

// Form input
<Input label="Email" placeholder="Enter email" />

// Status badge
<StatusBadge kind="success">Confirmed</StatusBadge>

// Heading with proper typography
<Heading4 className="text-text-primary" bold>Title</Heading4>

// Body text
<Body3 className="text-text-secondary">Description</Body3>

// Monospace for blockchain data
<Ui4 className="text-text-secondary font-mono">{address}</Ui4>
```

### Semantic Color Classes

```tsx
// Text
text-text-primary          // Primary text
text-text-secondary        // Secondary/muted text
text-text-tertiary         // Tertiary/disabled text
text-text-brand            // Brand accent (brick)

// Backgrounds
bg-surface-higher          // Elevated surface (lightest)
bg-surface-primary         // Main surface
bg-surface-lower           // Recessed surface

// Borders
border-border-primary      // Strong borders
border-border-secondary    // Standard borders
border-border-tertiary     // Subtle borders

// Inverse (dark mode / dark surfaces)
text-text-primary-inverse
bg-surface-primary-inverse
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-01 | Initial design system specification |
