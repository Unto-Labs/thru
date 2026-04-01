# Foundations

Core principles and philosophies that guide all design decisions in the Thru ecosystem.

## Contents

1. [Design Principles](#design-principles)
2. [Accessibility](#accessibility)
3. [Layout System](#layout-system)
4. [Interaction States](#interaction-states)
5. [Responsive Design](#responsive-design)

---

## Design Principles

### Industrial Precision

Thru's visual identity draws from industrial and mechanical aesthetics—precision engineering, reliability, and clarity.

| Principle | Application |
|-----------|-------------|
| Clean geometry | **Sharp corners on ALL elements** (no `rounded-*`) |
| Structured grids | Align elements to 4px/8px grid |
| Consistent rhythm | Use standardized spacing increments |
| Purposeful borders | Prefer solid 1px borders over shadows |
| Technical typography | Monospace for addresses, signatures, numbers |

**MANDATORY: Sharp Corners Policy**

All UI elements must have sharp (90°) corners. This is a core brand requirement.

```tsx
// CORRECT - Sharp corners
<Button className="...">Action</Button>
<Card className="border p-4">Content</Card>
<input className="border p-2" />

// INCORRECT - Never use rounded corners
<Button className="rounded-lg">Action</Button>  // NO
<Card className="rounded-xl p-4">Content</Card>  // NO
<input className="rounded-md p-2" />  // NO
```

**Only exceptions (require explicit justification):**
- Token/coin icons (circular by industry convention)
- Avatar images (circular is acceptable)
- Spinner/loading indicators (circular motion)

**Do:**
- Use consistent spacing multiples (4, 8, 12, 16, 24, 32, 48)
- Align elements precisely to grid
- Display blockchain data in monospace
- Use solid borders for container definition
- Keep all corners sharp (90°)

**Don't:**
- Use `rounded-*` classes on buttons, cards, inputs, or containers
- Mix rounded and sharp corners
- Use inconsistent spacing values
- Display technical data in sans-serif
- Use decorative shadows for structural elements

### Transparent Trust

Blockchain demands transparency. Interfaces must clearly communicate state and provide honest feedback.

| Principle | Application |
|-----------|-------------|
| Explicit status | Always show transaction state (pending/success/failed) |
| Visible feedback | Every action gets visible acknowledgment |
| Honest empty states | Show "No data" rather than hiding sections |
| Progressive disclosure | Reveal complexity gradually |

**Status Color Coding:**

| Status | Background | Text | Usage |
|--------|------------|------|-------|
| Success | `bg-grass-100` | `text-grass-400` | Confirmed transactions |
| Pending | `bg-yellow-100` | `text-yellow-400` | Processing states |
| Failed | `bg-brick-100` | `text-brick-400` | Errors, rejections |
| Info | `bg-sky-100` | `text-sky-400` | Informational messages |
| Neutral | `bg-steel-200` | `text-steel-400` | Default, unknown |

### Accessible Performance

Every user should interact efficiently regardless of device, connection, or ability.

| Principle | Application |
|-----------|-------------|
| Keyboard accessible | All interactions via Tab/Enter/Space/Escape |
| Screen reader compatible | Semantic HTML, ARIA labels |
| Touch-friendly | Minimum 44px touch targets |
| Fast loading | Skeleton states, lazy loading |
| Color independent | Never use color alone for meaning |

---

## Accessibility

### WCAG 2.1 AA Compliance

All Thru applications must meet WCAG 2.1 Level AA standards.

#### Color Contrast Requirements

| Element Type | Minimum Ratio | Example |
|--------------|---------------|---------|
| Normal text (<18px) | 4.5:1 | `text-text-primary` on `bg-surface-primary` |
| Large text (≥18px or ≥14px bold) | 3:1 | Headings |
| UI components | 3:1 | Button borders, icons |
| Focus indicators | 3:1 | Outline on focused elements |

#### Color Independence

Never use color as the sole indicator of meaning:

```tsx
// CORRECT: Icon + color + text
<StatusBadge kind="success">
  <CheckIcon className="mr-1" />
  Confirmed
</StatusBadge>

// INCORRECT: Color only
<div className="w-3 h-3 rounded-full bg-grass-400" />
```

### Keyboard Navigation

All interactive elements must support keyboard interaction:

| Key | Action |
|-----|--------|
| Tab | Move focus forward |
| Shift+Tab | Move focus backward |
| Enter/Space | Activate focused element |
| Escape | Close modal/dropdown, cancel action |
| Arrow keys | Navigate within component (menus, tabs) |

**Implementation Pattern:**

```tsx
<div
  role="button"
  tabIndex={0}
  onClick={handleClick}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  }}
>
  Clickable Element
</div>
```

### Focus Indicators

Focus must be clearly visible:

```css
/* Standard focus ring */
:focus-visible {
  outline: 2px solid var(--color-border-brand);
  outline-offset: 2px;
}

/* Input focus state */
.input:focus-within {
  border-color: var(--color-border-primary);
  background-color: var(--color-golden);
}
```

### Screen Reader Support

| Requirement | Implementation |
|-------------|----------------|
| Semantic HTML | Use `<button>`, `<nav>`, `<main>`, `<header>`, `<footer>` |
| Icon buttons | Add `aria-label="Description"` |
| Dynamic content | Use `aria-live="polite"` regions |
| Decorative elements | Add `aria-hidden="true"` |
| Form fields | Associate labels with `htmlFor`/`id` |

```tsx
// Icon button
<Button aria-label="Copy address to clipboard">
  <CopyIcon aria-hidden="true" />
</Button>

// Live region for updates
<div aria-live="polite" aria-atomic="true">
  {notification && <span>{notification}</span>}
</div>
```

---

## Layout System

### Container Widths

| Name | Width | Usage |
|------|-------|-------|
| Narrow | 640px | Forms, focused content |
| Default | 1280px | Main content areas |
| Wide | 1600px | Data-heavy displays |

```tsx
// Standard container
<div className="container mx-auto px-4 sm:px-6 md:px-8 max-w-7xl">
  {content}
</div>
```

### Page Structure

```
┌─────────────────────────────────────────┐
│  Header (sticky, z-50, border-bottom)   │
├─────────────────────────────────────────┤
│                                         │
│  Main Content Area (flex-1, min-h)      │
│                                         │
│    ┌─────────────────────────────┐      │
│    │   Container (max-w, mx-auto)│      │
│    │                             │      │
│    │   Content with padding      │      │
│    │                             │      │
│    └─────────────────────────────┘      │
│                                         │
├─────────────────────────────────────────┤
│  Footer (border-top)                    │
└─────────────────────────────────────────┘
```

### Grid Patterns

**Responsive Grid:**
```tsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  {items.map(item => <Card key={item.id}>{item}</Card>)}
</div>
```

**Dashboard Layout:**
```tsx
<div className="grid grid-cols-12 gap-4">
  <div className="col-span-12 lg:col-span-8">{mainContent}</div>
  <div className="col-span-12 lg:col-span-4">{sidebar}</div>
</div>
```

---

## Interaction States

Every interactive element has defined visual states:

| State | Trigger | Visual Change |
|-------|---------|---------------|
| Default | None | Base appearance |
| Hover | Mouse over | Background lightens/darkens |
| Focus | Tab focus | Visible outline ring |
| Active | Mouse down | Slight opacity reduction |
| Disabled | `disabled` attribute | 50% opacity, `cursor-not-allowed` |
| Loading | Async operation | Spinner, skeleton |

### Button State Example

```tsx
const buttonStyles = {
  base: 'transition-colors font-semibold cursor-pointer',
  states: `
    hover:bg-surface-higher-inverse
    focus:bg-surface-higher-inverse
    focus:outline-none
    focus-visible:ring-2
    focus-visible:ring-border-brand
    disabled:opacity-50
    disabled:cursor-not-allowed
  `,
};
```

### Loading States

**Content Loading (Skeleton):**
```tsx
{isLoading ? (
  <div className="animate-pulse bg-surface-lower h-4 w-32 rounded" />
) : (
  <span>{data}</span>
)}
```

**Action Loading (Spinner):**
```tsx
<Button disabled={isSubmitting}>
  {isSubmitting && <Loader2 className="animate-spin mr-2 h-4 w-4" />}
  {isSubmitting ? 'Processing...' : 'Submit'}
</Button>
```

---

## Responsive Design

### Breakpoint Strategy

| Breakpoint | Width | Primary Target |
|------------|-------|----------------|
| Base | 0px | Mobile portrait |
| `sm` | 600px | Mobile landscape, small tablets |
| `md` | 840px | Tablets |
| `lg` | 1200px | Desktops |
| `xl` | 1600px | Large displays |

### Mobile-First Approach

Write base styles for mobile, enhance for larger screens:

```tsx
<div className="
  flex flex-col         /* Mobile: stack vertically */
  md:flex-row           /* Tablet+: horizontal layout */
  gap-4                 /* Mobile: 16px gap */
  md:gap-6              /* Tablet+: 24px gap */
">
```

### Responsive Patterns

**Navigation:**
```tsx
// Full logo on desktop, icon on mobile
<Image src="/logo-full.svg" className="hidden sm:block h-10" />
<Image src="/logo-icon.svg" className="block sm:hidden h-10" />
```

**Data Tables:**
- Horizontal scroll on mobile (`overflow-x-auto`)
- Stack key columns vertically on smallest screens
- Hide non-essential columns with `hidden sm:table-cell`

**Touch Targets:**
```tsx
// Minimum 44px on mobile
<Button className="h-11 min-w-11 p-3">
  <Icon className="h-5 w-5" />
</Button>
```

**Container Queries (Component-Level):**
```css
@container (min-width: 400px) {
  .card-layout {
    flex-direction: row;
  }
}
```
