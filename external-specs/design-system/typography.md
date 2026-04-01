# Typography

The Thru typography system balances readability with technical precision, using two carefully chosen font families.

## Contents

1. [Font Families](#font-families)
2. [Type Scale](#type-scale)
3. [Typography Components](#typography-components)
4. [Usage Guidelines](#usage-guidelines)

---

## Font Families

### Inter Tight (Sans-Serif)

**Primary font** for headings, body text, and UI elements.

```css
--font-sans: var(--font-inter-tight);
```

| Weight | Value | Usage |
|--------|-------|-------|
| Regular | 400 | Body text, descriptions |
| Semibold | 600 | Headings, emphasis |

**Characteristics:**
- Optimized for screen readability
- Tighter letter-spacing than standard Inter
- Professional, clean appearance
- Excellent at small sizes

### JetBrains Mono (Monospace)

**Technical font** for blockchain data, code, and technical displays.

```css
--font-mono: var(--font-jetbrains-mono);
```

| Weight | Value | Usage |
|--------|-------|-------|
| Regular | 400 | Addresses, signatures, data |
| Bold | 700 | Emphasized technical text |

**Characteristics:**
- Designed for code readability
- Distinct characters (0 vs O, 1 vs l)
- Consistent width for data alignment
- Technical, precise appearance

### Font Loading

Fonts are loaded via `next/font/local` in each application:

```typescript
// Example: wallet/src/lib/fonts.ts
import localFont from 'next/font/local';

export const interTight = localFont({
  src: '../fonts/InterTight-Variable.woff2',
  variable: '--font-inter-tight',
});

export const jetbrainsMono = localFont({
  src: '../fonts/JetBrainsMono-Variable.woff2',
  variable: '--font-jetbrains-mono',
});
```

---

## Type Scale

### Headline Sizes

For Tailwind utility classes (direct size control):

| Token | Size | Line Height | Usage |
|-------|------|-------------|-------|
| `headline-2xl` | 5rem (80px) | — | Hero sections |
| `headline-xl` | 4rem (64px) | — | Page titles |
| `headline-l` | 3rem (48px) | — | Section titles |
| `headline-m` | 2.5rem (40px) | — | Large headings |
| `headline-s` | 2rem (32px) | — | Medium headings |
| `headline-xs` | 1.5rem (24px) | — | Small headings |

### Body Sizes

| Token | Size | Line Height | Usage |
|-------|------|-------------|-------|
| `body-xl` | 1.25rem (20px) | — | Large body, intro |
| `body-l` | 1.125rem (18px) | — | Featured body |
| `body-m` | 1rem (16px) | — | Default body |
| `body-s` | 0.875rem (14px) | — | Secondary body |
| `body-xs` | 0.75rem (12px) | — | Captions, small text |

---

## Typography Components

The design system provides pre-configured typography components with responsive sizing.

### Heading Components

| Component | Base Size | SM (600px) | MD (840px) | Weight |
|-----------|-----------|------------|------------|--------|
| `Heading1` | 2.5rem | 3rem | 4rem | 400/600 |
| `Heading2` | 2.5rem | 2.75rem | 3rem | 400/600 |
| `Heading3` | 2rem | 2.25rem | 2.5rem | 400/600 |
| `Heading4` | 1.75rem | — | 2rem | 400/600 |
| `Heading5` | 1.5rem | — | — | 400/600 |

```tsx
import { Heading1, Heading4 } from '@thru/design-system';

// Regular weight
<Heading1>Page Title</Heading1>

// Bold weight
<Heading4 bold>Section Title</Heading4>

// Custom element
<Heading2 as="h3">Styled as H2, semantic H3</Heading2>
```

### Body Components

| Component | Base Size | XL (1600px) | Line Height |
|-----------|-----------|-------------|-------------|
| `Body1` | 1.25rem | — | 1.75rem |
| `Body3` | 1rem | 1.125rem | 1.5rem / 1.75rem |
| `Body4` | 0.875rem | 1rem | 1.25rem / 1.5rem |
| `Body5` | 0.75rem | 0.875rem | 1rem / 1.25rem |

```tsx
import { Body3, Body4 } from '@thru/design-system';

<Body3>Main paragraph text</Body3>
<Body4 className="text-text-secondary">Secondary description</Body4>
<Body4 bold>Emphasized text</Body4>
```

### UI Components (Monospace)

For technical data display:

| Component | Size | Line Height | Letter Spacing |
|-----------|------|-------------|----------------|
| `Ui1` | 1.25rem | 1.75rem | -0.03125rem |
| `Ui2` | 1.125rem | 1.75rem | -0.015625rem |
| `Ui3` | 1rem | 1.5rem | — |
| `Ui4` | 0.875rem | 1.25rem | — |
| `Ui5` | 0.75rem | 1rem | — |

```tsx
import { Ui3, Ui4 } from '@thru/design-system';

// Address display
<Ui4 className="text-text-secondary">{walletAddress}</Ui4>

// Signature
<Ui3 bold>{transactionSignature}</Ui3>
```

### Button Typography

| Component | Size | Line Height | Weight |
|-----------|------|-------------|--------|
| `Button1` | 0.875rem | 1.25rem | 400/600 |

```tsx
import { Button1 } from '@thru/design-system';

<Button1 bold>BUTTON TEXT</Button1>
```

---

## CSS Classes

Direct CSS class usage for more control:

### Heading Classes

```css
.type-heading-1      /* 2.5rem → 3rem → 4rem responsive */
.type-heading-1-bold /* + font-weight: 600 */

.type-heading-2      /* 2.5rem → 2.75rem → 3rem responsive */
.type-heading-2-bold

.type-heading-3      /* 2rem → 2.25rem → 2.5rem responsive */
.type-heading-3-bold

.type-heading-4      /* 1.75rem → 2rem responsive */
.type-heading-4-bold

.type-heading-5      /* 1.5rem */
.type-heading-5-bold
```

### Body Classes

```css
.type-body-1       /* 1.25rem / 1.75rem line height */
.type-body-1-bold

.type-body-3       /* 1rem → 1.125rem at xl */
.type-body-3-bold

.type-body-4       /* 0.875rem → 1rem at xl */
.type-body-4-bold

.type-body-5       /* 0.75rem → 0.875rem at xl */
.type-body-5-bold
```

### UI Classes (Monospace)

```css
.type-ui-1        /* 1.25rem, tight letter-spacing */
.type-ui-1-bold

.type-ui-2        /* 1.125rem */
.type-ui-2-bold

.type-ui-3        /* 1rem */
.type-ui-3-bold

.type-ui-4        /* 0.875rem */
.type-ui-4-bold

.type-ui-5        /* 0.75rem → 0.875rem at xl */
.type-ui-5-bold
```

### Button Classes

```css
.type-button-1       /* 0.875rem */
.type-button-1-bold  /* + font-weight: 600 */
```

---

## Usage Guidelines

### When to Use Each Font

| Content Type | Font Family | Example |
|--------------|-------------|---------|
| Headings | Inter Tight | Page titles, section headers |
| Body text | Inter Tight | Paragraphs, descriptions |
| UI labels | Inter Tight | Button text, form labels |
| Addresses | JetBrains Mono | Wallet addresses, public keys |
| Signatures | JetBrains Mono | Transaction signatures |
| Numbers | JetBrains Mono | Balances, block numbers |
| Code | JetBrains Mono | Code snippets, technical data |

### Hierarchy Examples

**Page Header:**
```tsx
<header>
  <Heading3 bold className="text-text-primary">Account Details</Heading3>
  <Body4 className="text-text-secondary">View and manage your wallet</Body4>
</header>
```

**Card Content:**
```tsx
<Card>
  <Heading5 bold className="text-text-primary">Balance</Heading5>
  <div className="flex items-baseline gap-2">
    <Ui3 bold className="text-text-primary">{balance}</Ui3>
    <Body4 className="text-text-tertiary">THRU</Body4>
  </div>
</Card>
```

**Data Row:**
```tsx
<div className="flex justify-between">
  <Ui4 className="text-text-secondary">Address</Ui4>
  <Ui4 className="text-text-primary font-mono">{address}</Ui4>
</div>
```

### Do's

1. **Use typography components** for consistent styling
   ```tsx
   <Heading4 bold>Title</Heading4>  // Good
   <h4 className="text-2xl font-bold">Title</h4>  // Avoid
   ```

2. **Apply color via className**
   ```tsx
   <Body3 className="text-text-secondary">Muted text</Body3>
   ```

3. **Use monospace for blockchain data**
   ```tsx
   <Ui4>{transactionSignature}</Ui4>
   ```

4. **Respect the type hierarchy**
   - One H1 per page
   - Headings in logical order (H1 → H2 → H3)
   - Use body text for content, UI for data

### Don'ts

1. **Don't skip heading levels**
   ```tsx
   // Bad
   <Heading1>Page</Heading1>
   <Heading4>Section</Heading4>  // Skipped H2, H3

   // Good
   <Heading1>Page</Heading1>
   <Heading2>Section</Heading2>
   ```

2. **Don't use sans-serif for addresses**
   ```tsx
   // Bad
   <Body4>{walletAddress}</Body4>

   // Good
   <Ui4>{walletAddress}</Ui4>
   ```

3. **Don't override font sizes arbitrarily**
   ```tsx
   // Bad
   <Heading4 className="text-3xl">Custom size</Heading4>

   // Good - use the appropriate component
   <Heading3>Larger heading</Heading3>
   ```

### Truncation

For long text (addresses, signatures):

```tsx
// Truncate with ellipsis
<Ui4 className="truncate max-w-48">{longAddress}</Ui4>

// Show first/last characters
<Ui4>{address.slice(0, 6)}...{address.slice(-4)}</Ui4>
```
