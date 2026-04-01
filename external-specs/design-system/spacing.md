# Spacing & Layout

A consistent spacing system ensures visual harmony and predictable layouts across all Thru applications.

## Contents

1. [Spacing Scale](#spacing-scale)
2. [Layout Grid](#layout-grid)
3. [Component Spacing](#component-spacing)
4. [Responsive Spacing](#responsive-spacing)
5. [Sizing](#sizing)

---

## Spacing Scale

Thru uses a 4px base unit with a harmonious scale.

### Core Scale

| Token | Value | Pixels | Common Usage |
|-------|-------|--------|--------------|
| `0` | 0 | 0px | Reset spacing |
| `0.5` | 0.125rem | 2px | Hairline gaps |
| `1` | 0.25rem | 4px | Tight spacing |
| `1.5` | 0.375rem | 6px | Small gaps |
| `2` | 0.5rem | 8px | Default small |
| `2.5` | 0.625rem | 10px | — |
| `3` | 0.75rem | 12px | Medium tight |
| `4` | 1rem | 16px | Default medium |
| `5` | 1.25rem | 20px | — |
| `6` | 1.5rem | 24px | Default large |
| `8` | 2rem | 32px | Section spacing |
| `10` | 2.5rem | 40px | — |
| `12` | 3rem | 48px | Large sections |
| `16` | 4rem | 64px | Major sections |
| `20` | 5rem | 80px | — |
| `24` | 6rem | 96px | Page sections |

### Preferred Values

For consistency, prefer these commonly used values:

| Context | Recommended | Tailwind |
|---------|-------------|----------|
| Icon to text | 8px | `gap-2` |
| Between form fields | 16px | `gap-4` or `space-y-4` |
| Card padding | 16-24px | `p-4` or `p-6` |
| Section spacing | 32-48px | `py-8` or `py-12` |
| Between cards | 16px | `gap-4` |
| Page margin | 16-32px | `px-4 md:px-8` |

---

## Layout Grid

### Container

The main content container centers content with responsive padding:

```tsx
<div className="container mx-auto px-4 sm:px-6 md:px-8 max-w-7xl">
  {content}
</div>
```

| Breakpoint | Side Padding | Container Max |
|------------|--------------|---------------|
| Base (mobile) | 16px (`px-4`) | 100% |
| SM (600px) | 24px (`px-6`) | 100% |
| MD (840px) | 32px (`px-8`) | 100% |
| LG+ | 32px (`px-8`) | 1280px |

### Column Grid

Use CSS Grid for multi-column layouts:

```tsx
// 12-column grid
<div className="grid grid-cols-12 gap-4">
  <div className="col-span-12 lg:col-span-8">{main}</div>
  <div className="col-span-12 lg:col-span-4">{sidebar}</div>
</div>

// Auto-fit responsive grid
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  {items.map(item => <Card key={item.id}>{item}</Card>)}
</div>
```

### Stack Layout

Vertical stacking with consistent gaps:

```tsx
// Form fields
<div className="flex flex-col gap-4">
  <Input label="Name" />
  <Input label="Email" />
  <Button>Submit</Button>
</div>

// Content sections
<div className="space-y-8">
  <section>{hero}</section>
  <section>{features}</section>
  <section>{cta}</section>
</div>
```

---

## Component Spacing

### Cards

```tsx
// Standard card
<Card className="p-4">        {/* 16px padding */}
<Card className="p-6">        {/* 24px padding */}

// Card with sections
<Card className="p-4">
  <div className="mb-4">      {/* 16px bottom margin */}
    <Heading5>Title</Heading5>
  </div>
  <div className="space-y-3"> {/* 12px between items */}
    {items}
  </div>
</Card>
```

### Buttons

| Size | Horizontal | Vertical | Height |
|------|------------|----------|--------|
| `sm` | 12px (`px-3`) | 6px (`py-1.5`) | ~32px |
| `md` | 24px (`px-6`) | 12px (`py-3`) | ~44px |
| `lg` | 32px (`px-8`) | 16px (`py-4`) | ~56px |

```tsx
<Button size="sm">Small</Button>   {/* px-3 py-1.5 */}
<Button size="md">Medium</Button>  {/* px-6 py-3 */}
<Button size="lg">Large</Button>   {/* px-8 py-4 */}
```

### Inputs

```tsx
// Input wrapper
<div className="p-4">              {/* 16px padding */}
  <input className="..." />
</div>

// With label
<div className="space-y-2">        {/* 8px between label and input */}
  <label>Field Label</label>
  <Input />
</div>
```

### Data Tables

```tsx
// Table cell padding
<td className="px-4 py-3">         {/* 16px horizontal, 12px vertical */}

// Between table and pagination
<div className="mt-4">             {/* 16px gap */}
  <PaginationFooter />
</div>
```

### Headers & Footers

```tsx
// Global header
<header className="py-1.5">        {/* 6px vertical */}
  <div className="px-4 sm:px-6 md:px-8">
    {/* Responsive horizontal padding */}
  </div>
</header>

// Section header in card
<div className="mb-4">             {/* 16px below header */}
  <Heading4>Section Title</Heading4>
</div>
```

---

## Responsive Spacing

### Padding

```tsx
// Page container
<main className="
  px-4              /* Mobile: 16px */
  sm:px-6           /* SM: 24px */
  md:px-8           /* MD+: 32px */
  py-6              /* Mobile: 24px */
  md:py-8           /* MD+: 32px */
">
```

### Gaps

```tsx
// Card grid
<div className="
  grid
  gap-4             /* Mobile: 16px */
  md:gap-6          /* MD+: 24px */
">

// Flex layout
<div className="
  flex flex-col
  gap-4             /* Mobile: 16px */
  md:flex-row
  md:gap-6          /* MD+: 24px horizontal */
">
```

### Margins

```tsx
// Section margins
<section className="
  mb-8              /* Mobile: 32px */
  md:mb-12          /* MD+: 48px */
">

// Content block
<div className="
  mt-4              /* Mobile: 16px */
  md:mt-6           /* MD+: 24px */
">
```

---

## Sizing

### Fixed Sizes

| Token | Value | Usage |
|-------|-------|-------|
| `h-10` | 40px | Input height, small buttons |
| `h-11` | 44px | Touch-friendly buttons |
| `h-12` | 48px | Large buttons |
| `w-10` | 40px | Icon buttons |
| `w-11` | 44px | Touch target minimum |

### Touch Targets

Minimum 44×44px for touch devices:

```tsx
// Icon button
<button className="h-11 w-11 p-3">
  <Icon className="h-5 w-5" />
</button>

// Text button with adequate height
<Button className="h-11">Action</Button>
```

### Aspect Ratios

```tsx
// Square
<div className="aspect-square" />

// Video
<div className="aspect-video" />  {/* 16:9 */}

// Custom
<div className="aspect-[4/3]" />
```

### Max Widths

| Class | Width | Usage |
|-------|-------|-------|
| `max-w-sm` | 384px | Small cards |
| `max-w-md` | 448px | Modal dialogs |
| `max-w-lg` | 512px | Forms |
| `max-w-xl` | 576px | Content blocks |
| `max-w-2xl` | 672px | Wide forms |
| `max-w-4xl` | 896px | Wide content |
| `max-w-7xl` | 1280px | Page container |

```tsx
// Form container
<div className="max-w-lg mx-auto">
  <Form />
</div>

// Page content
<main className="max-w-7xl mx-auto">
  {content}
</main>
```

---

## Spacing Patterns

### Form Layout

```tsx
<form className="space-y-4">           {/* 16px between fields */}
  <div className="space-y-2">          {/* 8px between label/input */}
    <label>Email</label>
    <Input type="email" />
  </div>

  <div className="space-y-2">
    <label>Password</label>
    <Input type="password" />
  </div>

  <div className="pt-4">               {/* Extra 16px before button */}
    <Button className="w-full">Submit</Button>
  </div>
</form>
```

### Card Grid

```tsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  {cards.map(card => (
    <Card key={card.id} className="p-4">
      <div className="mb-3">           {/* 12px below title */}
        <Heading5>{card.title}</Heading5>
      </div>
      <Body4>{card.description}</Body4>
    </Card>
  ))}
</div>
```

### Summary Data

```tsx
<Card className="p-4">
  <div className="space-y-3">          {/* 12px between rows */}
    <div className="flex justify-between items-center">
      <Ui4 className="text-text-secondary">Label</Ui4>
      <Ui4 className="text-text-primary">{value}</Ui4>
    </div>
    <div className="flex justify-between items-center">
      <Ui4 className="text-text-secondary">Label</Ui4>
      <Ui4 className="text-text-primary">{value}</Ui4>
    </div>
  </div>
</Card>
```

### Page Section

```tsx
<section className="py-12 md:py-16">   {/* Vertical padding */}
  <div className="container mx-auto px-4 md:px-8 max-w-7xl">
    <div className="mb-8 md:mb-12">    {/* Space below header */}
      <Heading2>Section Title</Heading2>
      <Body3 className="mt-4">Description text</Body3>
    </div>

    <div className="grid gap-6">
      {content}
    </div>
  </div>
</section>
```
