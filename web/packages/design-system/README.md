# @thru/design-system

Thru Design System - Complete design tokens, components, and utilities for building Thru-branded applications.

## Installation

```bash
npm install @thru/design-system
# or
pnpm add @thru/design-system
```

## Quick Start

### 1. Configure Tailwind CSS v4

The design system uses Tailwind CSS v4 with CSS-first configuration. Import the theme CSS in your main stylesheet:

**In your `globals.css` or main CSS file:**

```css
@import "tailwindcss";
@import "@thru/design-system/tailwind.css";

/* Use @source to scan the design system package for class usage */
@source "../node_modules/@thru/design-system/src";
```

**Important notes:**
- Import `tailwindcss` **first**, then the design system CSS
- The `@source` directive tells Tailwind v4 to scan the design system's source files for class names
- Tailwind v4 automatically detects your app files (`app/`, `src/`, etc.), so you don't need `@source` for those
- The `@source` path should point to the `src` folder (not `dist`), so Tailwind can scan the original TypeScript/JSX files

**Optional: `tailwind.config.js`**

You typically don't need a `tailwind.config.js` file with Tailwind v4. If you do need one for other reasons, keep it minimal:

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  // Content paths are defined in CSS via @source directive
  // This file is only needed for other Tailwind plugins or custom config
};
```

### 2. Use Components

```tsx
import { Button, Input, Card } from '@thru/design-system';

export default function MyPage() {
  return (
    <Card>
      <Input label="Email" placeholder="> Email" />
      <Button variant="primary" className="mt-4">
        JOIN THE FLOCK
      </Button>
    </Card>
  );
}
```

## Color Usage

### Stone Scale (Neutrals)
```tsx
// Background
<div className="bg-stone-0">Light background</div>
<div className="bg-stone-100">Light gray background</div>

// Text
<p className="text-stone-700">Dark text</p>
<p className="text-stone-600">Medium-dark text</p>
```

### Brick (Primary Brand Color)
```tsx
<button className="bg-thru-brick text-white">
  Primary Action
</button>
```

### Secondary Colors
```tsx
<div className="bg-thru-saffron-400">Saffron accent</div>
<div className="bg-thru-ocean-400">Ocean accent</div>
<div className="bg-thru-forest-400">Forest accent</div>
<div className="bg-thru-sand-400">Sand accent</div>
```

## Typography

The design system uses Inter Tight as the primary font and JetBrains Mono for code.

### Font Sizes

```tsx
<h1 className="text-headline-2xl font-extrabold">Headline 2XL</h1>
<h2 className="text-headline-xl font-semibold">Headline XL</h2>
<h3 className="text-headline-l font-semibold">Headline L</h3>
<p className="text-body-m">Body text</p>
<code className="font-mono text-body-s">Code snippet</code>
```

## Components

### Button

```tsx
import { Button } from '@thru/design-system';

// Primary (default)
<Button variant="primary">Action</Button>

// Secondary (Brick color)
<Button variant="secondary">Action</Button>

// Outline
<Button variant="outline">Action</Button>

// Ghost
<Button variant="ghost">Action</Button>

// Sizes
<Button size="sm">Small</Button>
<Button size="md">Medium</Button>
<Button size="lg">Large</Button>
```

### Input

```tsx
import { Input } from '@thru/design-system';

// With label
<Input label="Email" type="email" placeholder="Enter email" />

// Without label
<Input placeholder="> Email" />

// Error state
<Input error placeholder="Invalid input" />
```

### Card

```tsx
import { Card } from '@thru/design-system';

// Default (with border)
<Card variant="default">Content</Card>

// Elevated (with shadow)
<Card variant="elevated">Content</Card>

// Outlined (thicker border)
<Card variant="outlined">Content</Card>
```

## Design Tokens

See [resources/design.md](../../resources/design.md) for complete design specifications including:
- Color palette with hex values
- Typography scale
- Spacing system
- Component guidelines
- Brand usage rules

## Fonts

The design system uses **Inter Tight** as the primary font and **JetBrains Mono** for code/monospace text. 

Font files are not included in this package. Font files are stored in the `resources/Fonts/` directory at the repository root. Each Next.js application should:
1. Copy font files from `resources/Fonts/` to a static directory in the app
2. Set up font loaders in the app using `next/font/local`

See the wallet app implementation (`wallet/src/lib/fonts.ts`) for an example setup.

## Troubleshooting

### Classes from design system components not appearing

If you see unstyled components (e.g., buttons without background colors), Tailwind may not be detecting classes from the design system package.

**Solution:** Ensure the `@source` directive in your CSS file points to the correct path. The path is relative to your CSS file location:

- If your CSS is in `app/globals.css`, use: `@source "../node_modules/@thru/design-system/src"`
- If your CSS is in `src/styles/globals.css`, use: `@source "../../node_modules/@thru/design-system/src"`

**Important:** 
- The path should point to the `src` folder (not `dist`)
- Tailwind v4 auto-detects your app files, so you only need `@source` for external packages
- Make sure the import order is correct: `@import "tailwindcss"` first, then the design system CSS

## License

See package.json for license information.

