# Components

Reusable UI components that form the building blocks of Thru applications.

## Contents

1. [Core Components](#core-components)
2. [Data Display](#data-display)
3. [Navigation](#navigation)
4. [Feedback](#feedback)
5. [Blockchain-Specific](#blockchain-specific)

---

## Core Components

### Button

Interactive element for triggering actions.

**Variants:**

| Variant | Usage | Appearance |
|---------|-------|------------|
| `primary` | Main CTAs | Dark background, light text |
| `secondary` | Brand actions | Brick background |
| `outline` | Secondary actions | Bordered, transparent |
| `ghost` | Tertiary actions | Text only |

**Sizes:**

| Size | Padding | Height | Usage |
|------|---------|--------|-------|
| `sm` | `px-3 py-1.5` | ~32px | Inline actions |
| `md` | `px-6 py-3` | ~44px | Default |
| `lg` | `px-8 py-4` | ~56px | Hero CTAs |

**States:**
- Default, Hover, Focus, Active, Disabled, Loading

```tsx
import { Button } from '@thru/design-system';

// Variants
<Button variant="primary">Primary Action</Button>
<Button variant="secondary">Brand Action</Button>
<Button variant="outline">Secondary</Button>
<Button variant="ghost">Tertiary</Button>

// Sizes
<Button size="sm">Small</Button>
<Button size="md">Medium</Button>
<Button size="lg">Large</Button>

// States
<Button disabled>Disabled</Button>
<Button>
  {isLoading && <Loader2 className="animate-spin mr-2 h-4 w-4" />}
  {isLoading ? 'Loading...' : 'Submit'}
</Button>

// Full width
<Button className="w-full">Full Width</Button>
```

**Styling:**
```tsx
const variants = {
  primary: 'bg-surface-lower-inverse text-text-primary-inverse hover:bg-surface-higher-inverse',
  secondary: 'bg-surface-brick text-text-primary-inverse hover:opacity-90',
  outline: 'border border-border-primary text-text-primary hover:bg-surface-lower',
  ghost: 'text-text-primary hover:bg-surface-lower',
};
```

---

### Card

Container for grouping related content.

**Variants:**

| Variant | Appearance | Usage |
|---------|------------|-------|
| `default` | White/light bg, subtle border | Standard containers |
| `elevated` | Shadow + border | Emphasized content |
| `outlined` | Heavier border | Strong definition |

```tsx
import { Card } from '@thru/design-system';

<Card variant="default" className="p-4">
  <Heading5>Card Title</Heading5>
  <Body4>Card content goes here.</Body4>
</Card>

<Card variant="elevated" className="p-6">
  Elevated card with shadow
</Card>

<Card variant="outlined">
  Strongly outlined card
</Card>
```

**Styling:**
```tsx
const variants = {
  default: 'bg-white border border-stone-300',
  elevated: 'bg-white shadow-lg border border-stone-300',
  outlined: 'bg-white border border-stone-800',
};
```

---

### Input

Text input field with label support.

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `label` | string | Optional label above input |
| `error` | boolean | Error state styling |
| `wrapperClassName` | string | Styles for outer wrapper |

**States:**
- Default, Focus (golden background), Error, Disabled

```tsx
import { Input } from '@thru/design-system';

// Basic
<Input placeholder="Enter text..." />

// With label
<Input label="Email Address" type="email" placeholder="you@example.com" />

// Error state
<Input error placeholder="Invalid input" />

// Custom styling
<Input
  wrapperClassName="h-10"
  className="text-sm"
  placeholder="Compact input"
/>
```

**Focus Behavior:**
- Border color changes to `border-primary`
- Background changes to `golden` (#ffffbd)
- Wrapper is clickable to focus input

---

### Text Components

Typography components with consistent styling.

**Headings:**
```tsx
import { Heading1, Heading2, Heading3, Heading4, Heading5 } from '@thru/design-system';

<Heading1>Hero Title</Heading1>
<Heading2 bold>Section Title</Heading2>
<Heading3 as="h2">Custom semantic element</Heading3>
<Heading4 className="text-text-brand">Colored heading</Heading4>
<Heading5 bold>Card Title</Heading5>
```

**Body:**
```tsx
import { Body1, Body3, Body4, Body5 } from '@thru/design-system';

<Body1>Large intro paragraph</Body1>
<Body3>Standard body text</Body3>
<Body4 className="text-text-secondary">Secondary text</Body4>
<Body5>Small caption text</Body5>
```

**UI (Monospace):**
```tsx
import { Ui1, Ui2, Ui3, Ui4, Ui5 } from '@thru/design-system';

<Ui3>{walletAddress}</Ui3>
<Ui4 className="text-text-secondary">{signature}</Ui4>
<Ui5>{blockNumber}</Ui5>
```

---

## Data Display

### DataTable

Tabular data display with pagination, loading, and empty states.

**Features:**
- Server-side or client-side pagination
- Skeleton loading states
- Error and empty state messages
- Sortable columns (optional)
- Row click handlers

```tsx
import { DataTable } from '@/components/DataTable';

<DataTable
  columns={[
    { key: 'hash', header: 'Transaction', render: (row) => <Link>{row.hash}</Link> },
    { key: 'amount', header: 'Amount', render: (row) => <Ui4>{row.amount}</Ui4> },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge kind={row.status}>{row.status}</StatusBadge> },
  ]}
  rows={transactions}
  getRowKey={(row) => row.hash}
  isLoading={isLoading}
  error={error}
  pagination={{
    pageSize: 10,
    pageSizeOptions: [10, 25, 50],
    // For client-side: just provide rows array
    // For server-side: provide currentPage, hasNextPage, onNextPage, etc.
  }}
  onRowClick={(row) => router.push(`/tx/${row.hash}`)}
/>
```

### SummaryDatum

Key-value pair display for summary information.

```tsx
import { SummaryDatum } from '@/components/SummaryDatum';

<SummaryDatum
  label="Block Height"
  isLoading={isLoading}
  hasValue={!!blockHeight}
  value={<Ui4>{blockHeight}</Ui4>}
  skeleton={<Skeleton className="h-4 w-20" />}
/>
```

### Skeleton

Loading placeholder component.

```tsx
import { Skeleton, SignatureSkeleton } from '@/components/Skeleton';

// Generic skeleton
<Skeleton className="h-4 w-32" />
<Skeleton className="h-8 w-full" />

// Signature-specific
<SignatureSkeleton />
```

---

## Navigation

### GlobalHeader

Application header with logo and search.

```tsx
<header className="sticky top-0 z-50 border-b border-border-secondary bg-surface-lower py-1">
  <div className="container mx-auto px-4 sm:px-6 md:px-8 max-w-7xl">
    <div className="flex items-center gap-4">
      {/* Logo */}
      <div className="flex-1">
        <Image src="/logo.svg" />
      </div>

      {/* Search */}
      <form className="flex-[5] flex justify-end gap-2">
        <Input placeholder="Search..." />
        <Button type="submit">Search</Button>
      </form>
    </div>
  </div>
</header>
```

### TabButton

Tab navigation within a page section.

```tsx
<div className="flex gap-2 border-b border-border-tertiary">
  <TabButton active={activeTab === 'overview'} onClick={() => setActiveTab('overview')}>
    Overview
  </TabButton>
  <TabButton active={activeTab === 'transactions'} onClick={() => setActiveTab('transactions')}>
    Transactions
  </TabButton>
</div>
```

---

## Feedback

### StatusBadge

Visual indicator for status states.

**Kinds:**

| Kind | Background | Text | Usage |
|------|------------|------|-------|
| `success` | `grass-100` | `grass-400` | Confirmed, complete |
| `pending` | `yellow-100` | `yellow-400` | Processing, waiting |
| `failed` | `brick-100` | `brick-400` | Error, rejected |
| `info` | `sky-100` | `sky-400` | Information |
| `neutral` | `steel-200` | `steel-400` | Default, unknown |

```tsx
import { StatusBadge } from '@/components/StatusBadge';

<StatusBadge kind="success">Confirmed</StatusBadge>
<StatusBadge kind="pending">Pending</StatusBadge>
<StatusBadge kind="failed">Failed</StatusBadge>
<StatusBadge kind="info">Info</StatusBadge>
<StatusBadge kind="neutral">Unknown</StatusBadge>
```

**Styling:**
```tsx
<span className="
  font-mono
  inline-flex items-center
  px-2.5 py-1
  text-xs font-semibold
  uppercase tracking-wide
">
```

### Toast / Notifications

Temporary feedback messages (pattern, not a component yet).

```tsx
// Success toast pattern
<div className="bg-teal-500/10 border border-teal-500/30 p-3">
  <div className="flex items-center gap-2">
    <CheckCircle className="text-teal-500" />
    <Body4 className="text-teal-500">Operation successful!</Body4>
  </div>
</div>

// Error toast pattern
<div className="bg-brick-500/10 border border-brick-500/30 p-3">
  <div className="flex items-center gap-2">
    <XCircle className="text-brick-500" />
    <Body4 className="text-brick-500">Something went wrong</Body4>
  </div>
</div>
```

---

## Blockchain-Specific

### Signature

Truncated transaction signature display with copy functionality.

```tsx
import { Signature } from '@/components/Signature';

<Signature signature={txSignature} />
// Renders: "5KQwL...7xYz" with copy button
```

### CopyButton

Button to copy text to clipboard with feedback.

```tsx
import { CopyButton } from '@/components/CopyButton';

<div className="flex items-center gap-2">
  <Ui4>{address}</Ui4>
  <CopyButton text={address} />
</div>
```

### Timestamp

Formatted timestamp display.

```tsx
import { Timestamp } from '@/components/Timestamp';

<Timestamp value={transaction.timestamp} />
// Renders: "2 minutes ago" or "Jan 15, 2025 at 3:45 PM"
```

### BlockListItem / TransactionListItem

List item components for explorer displays.

```tsx
<BlockListItem
  slot={block.slot}
  timestamp={block.timestamp}
  transactions={block.transactionCount}
  onClick={() => router.push(`/block/${block.slot}`)}
/>

<TransactionListItem
  signature={tx.signature}
  status={tx.status}
  timestamp={tx.timestamp}
  onClick={() => router.push(`/tx/${tx.signature}`)}
/>
```

---

## Component Composition

### Wallet Connection Card

```tsx
<WalletConnectionCard
  onConnect={handleConnect}
  walletAvailable={!!wallet}
  title="Connect to Continue"
  description="Connect your wallet to access this feature."
/>
```

### Account Details Card

```tsx
<Card variant="default">
  {/* Header with edit */}
  <div className="flex items-center justify-between mb-8">
    <Heading4 bold>{account.label}</Heading4>
    <Button variant="ghost" size="sm">Rename</Button>
  </div>

  {/* Address section */}
  <div className="mb-8">
    <Body4 bold className="mb-3">Address</Body4>
    <div className="flex items-center gap-3">
      <div className="flex-1 px-4 py-3 bg-surface-higher border border-border-tertiary font-mono">
        {account.publicKey}
      </div>
      <CopyButton text={account.publicKey} />
    </div>
  </div>

  {/* Balance section */}
  <div>
    <Body4 bold className="mb-3">Balance</Body4>
    <Heading5 bold>{balance} <span className="text-text-tertiary font-normal">THRU</span></Heading5>
  </div>
</Card>
```

### Swap Card

```tsx
<Card variant="default" className="p-4">
  {/* Header */}
  <div className="flex items-center justify-between mb-4">
    <Heading4 className="!font-mono">Swap</Heading4>
    <SettingsButton />
  </div>

  {/* From token */}
  <SwapTokenInput label="You pay" token={tokenIn} amount={amountIn} />

  {/* Swap direction button */}
  <div className="flex justify-center -my-2 relative z-10">
    <button className="bg-surface-higher p-2 border border-border-secondary">
      <ArrowDown />
    </button>
  </div>

  {/* To token */}
  <SwapTokenInput label="You receive" token={tokenOut} amount={amountOut} readOnly />

  {/* Quote display */}
  {quote && <SwapQuoteDisplay quote={quote} />}

  {/* Action button */}
  <Button variant="primary" size="lg" className="w-full mt-4">
    Swap
  </Button>
</Card>
```
