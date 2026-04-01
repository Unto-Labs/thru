# Patterns

Common UI patterns and layouts used across Thru applications.

## Contents

1. [Page Layouts](#page-layouts)
2. [Forms](#forms)
3. [Data Display](#data-display)
4. [Wallet Interactions](#wallet-interactions)
5. [Transaction Flows](#transaction-flows)
6. [Empty & Error States](#empty--error-states)

---

## Page Layouts

### Standard Page

Basic page structure with header, content, and footer.

```tsx
<div className="min-h-screen flex flex-col bg-surface-primary">
  {/* Sticky header */}
  <GlobalHeader />

  {/* Main content - grows to fill space */}
  <main className="flex-1">
    <div className="container mx-auto px-4 sm:px-6 md:px-8 py-6 md:py-8 max-w-7xl">
      {children}
    </div>
  </main>

  {/* Footer */}
  <GlobalFooter />
</div>
```

### Detail Page

Page with title, summary card, and tabbed content.

```tsx
<div className="space-y-6">
  {/* Page title */}
  <PageTitle
    title="Transaction Details"
    subtitle={<Signature signature={txId} />}
  />

  {/* Summary card */}
  <TransactionSummaryCard transaction={data} isLoading={isLoading} />

  {/* Tabbed content */}
  <div>
    <div className="flex gap-2 border-b border-border-tertiary mb-4">
      <TabButton active={tab === 'instructions'}>Instructions</TabButton>
      <TabButton active={tab === 'accounts'}>Accounts</TabButton>
    </div>

    {tab === 'instructions' && <InstructionsTab data={data.instructions} />}
    {tab === 'accounts' && <AccountsTab data={data.accounts} />}
  </div>
</div>
```

### List Page

Page with search/filters and paginated data table.

```tsx
<div className="space-y-6">
  {/* Page header with filters */}
  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
    <Heading3 bold>Transactions</Heading3>
    <div className="flex gap-2">
      <Input placeholder="Search..." className="w-64" />
      <Select options={filterOptions} />
    </div>
  </div>

  {/* Data table */}
  <DataTable
    columns={columns}
    rows={data}
    isLoading={isLoading}
    pagination={pagination}
  />
</div>
```

### Dashboard Layout

Multi-column layout with sidebar content.

```tsx
<div className="grid grid-cols-12 gap-4 md:gap-6">
  {/* Main content - 8 columns on large screens */}
  <div className="col-span-12 lg:col-span-8 space-y-4">
    <StatsCard />
    <RecentTransactionsTable />
  </div>

  {/* Sidebar - 4 columns on large screens */}
  <div className="col-span-12 lg:col-span-4 space-y-4">
    <WalletCard />
    <QuickActions />
  </div>
</div>
```

---

## Forms

### Single-Column Form

Standard form layout with vertical stacking.

```tsx
<Card variant="default" className="max-w-lg mx-auto p-6">
  <Heading4 bold className="mb-6">Create Account</Heading4>

  <form className="space-y-4" onSubmit={handleSubmit}>
    <Input
      label="Account Name"
      placeholder="My Wallet"
      value={name}
      onChange={(e) => setName(e.target.value)}
    />

    <Input
      label="Email (optional)"
      type="email"
      placeholder="you@example.com"
      value={email}
      onChange={(e) => setEmail(e.target.value)}
    />

    <div className="pt-4">
      <Button type="submit" variant="primary" className="w-full">
        Create Account
      </Button>
    </div>
  </form>
</Card>
```

### Multi-Step Form

Wizard-style form with progress indication.

```tsx
<Card variant="default" className="p-6">
  {/* Progress indicator */}
  <div className="flex items-center gap-2 mb-6">
    {steps.map((step, i) => (
      <div key={i} className="flex items-center">
        <div className={cn(
          'w-8 h-8 flex items-center justify-center',
          i <= currentStep ? 'bg-surface-brick text-text-primary-inverse' : 'bg-surface-lower text-text-tertiary'
        )}>
          {i + 1}
        </div>
        {i < steps.length - 1 && (
          <div className={cn(
            'w-12 h-0.5',
            i < currentStep ? 'bg-surface-brick' : 'bg-surface-lower'
          )} />
        )}
      </div>
    ))}
  </div>

  {/* Step content */}
  <div className="min-h-[200px]">
    {currentStep === 0 && <StepOne />}
    {currentStep === 1 && <StepTwo />}
    {currentStep === 2 && <StepThree />}
  </div>

  {/* Navigation */}
  <div className="flex justify-between mt-6 pt-4 border-t border-border-tertiary">
    <Button
      variant="ghost"
      onClick={handleBack}
      disabled={currentStep === 0}
    >
      Back
    </Button>
    <Button
      variant="primary"
      onClick={handleNext}
    >
      {currentStep === steps.length - 1 ? 'Complete' : 'Continue'}
    </Button>
  </div>
</Card>
```

### Inline Edit Form

Edit-in-place pattern for existing data.

```tsx
const [isEditing, setIsEditing] = useState(false);
const [editValue, setEditValue] = useState(value);

{isEditing ? (
  <div className="flex items-center gap-3">
    <Input
      value={editValue}
      onChange={(e) => setEditValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') handleSave();
        if (e.key === 'Escape') handleCancel();
      }}
      autoFocus
    />
    <Button size="sm" onClick={handleSave}>Save</Button>
    <Button size="sm" variant="ghost" onClick={handleCancel}>Cancel</Button>
  </div>
) : (
  <div className="flex items-center justify-between">
    <Heading4 bold>{value}</Heading4>
    <Button size="sm" variant="ghost" onClick={() => setIsEditing(true)}>
      Edit
    </Button>
  </div>
)}
```

---

## Data Display

### Summary Card

Key-value pairs in a card layout.

```tsx
<Card variant="default" className="p-4">
  <div className="space-y-3">
    <SummaryDatum
      label="Status"
      isLoading={isLoading}
      hasValue={!!status}
      value={<StatusBadge kind={status}>{status}</StatusBadge>}
      skeleton={<Skeleton className="h-6 w-20" />}
    />

    <SummaryDatum
      label="Block"
      isLoading={isLoading}
      hasValue={!!block}
      value={<Link href={`/block/${block}`}><Ui4>{block}</Ui4></Link>}
      skeleton={<Skeleton className="h-4 w-24" />}
    />

    <SummaryDatum
      label="Timestamp"
      isLoading={isLoading}
      hasValue={!!timestamp}
      value={<Timestamp value={timestamp} />}
      skeleton={<Skeleton className="h-4 w-32" />}
    />

    <SummaryDatum
      label="Fee"
      isLoading={isLoading}
      hasValue={!!fee}
      value={<Ui4>{fee} THRU</Ui4>}
      skeleton={<Skeleton className="h-4 w-16" />}
    />
  </div>
</Card>
```

### Data Table with Actions

Table with row actions and status indicators.

```tsx
<DataTable
  columns={[
    {
      key: 'signature',
      header: 'Transaction',
      render: (row) => (
        <Link href={`/tx/${row.signature}`}>
          <Ui4 className="text-text-brand hover:underline">
            {truncate(row.signature)}
          </Ui4>
        </Link>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge kind={row.status}>{row.status}</StatusBadge>,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (row) => <Ui4>{formatAmount(row.amount)} THRU</Ui4>,
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="flex gap-2">
          <CopyButton text={row.signature} />
          <Button size="sm" variant="ghost">View</Button>
        </div>
      ),
    },
  ]}
  rows={transactions}
  getRowKey={(row) => row.signature}
  isLoading={isLoading}
  pagination={pagination}
/>
```

### Expandable Content

Accordion-style expandable sections.

```tsx
<Card variant="default">
  {sections.map((section, i) => (
    <div key={i} className="border-b border-border-tertiary last:border-0">
      <button
        className="w-full flex items-center justify-between p-4 hover:bg-surface-lower"
        onClick={() => toggleSection(i)}
      >
        <Heading5>{section.title}</Heading5>
        <ChevronDown className={cn(
          'transition-transform',
          expanded[i] && 'rotate-180'
        )} />
      </button>

      {expanded[i] && (
        <div className="px-4 pb-4">
          {section.content}
        </div>
      )}
    </div>
  ))}
</Card>
```

---

## Wallet Interactions

### Connect Wallet

Prompt to connect wallet before accessing features.

```tsx
<Card variant="default" className="p-8 text-center max-w-md mx-auto">
  <div className="mb-6">
    <WalletIcon className="h-16 w-16 mx-auto text-text-tertiary" />
  </div>

  <Heading4 bold className="mb-2">Connect Your Wallet</Heading4>
  <Body4 className="text-text-secondary mb-6">
    Connect your wallet to access this feature and manage your assets.
  </Body4>

  <Button
    variant="primary"
    size="lg"
    className="w-full"
    onClick={handleConnect}
    disabled={!walletAvailable}
  >
    {walletAvailable ? 'Connect Wallet' : 'No Wallet Detected'}
  </Button>

  {!walletAvailable && (
    <Body5 className="text-text-tertiary mt-4">
      Please install a compatible wallet extension.
    </Body5>
  )}
</Card>
```

### Account Selection

Account list with balance display.

```tsx
<Card variant="default" className="p-4">
  <Heading5 bold className="mb-4">Select Account</Heading5>

  <div className="space-y-2">
    {accounts.map((account) => (
      <button
        key={account.address}
        className={cn(
          'w-full flex items-center justify-between p-3 border transition-colors',
          selected === account.address
            ? 'border-border-brand bg-surface-lower'
            : 'border-border-tertiary hover:border-border-secondary'
        )}
        onClick={() => onSelect(account.address)}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-surface-brick flex items-center justify-center">
            <span className="text-text-primary-inverse text-sm font-bold">
              {account.label[0]}
            </span>
          </div>
          <div className="text-left">
            <Body4 bold>{account.label}</Body4>
            <Ui5 className="text-text-tertiary">{truncate(account.address)}</Ui5>
          </div>
        </div>
        <Ui4 className="text-text-secondary">{account.balance} THRU</Ui4>
      </button>
    ))}
  </div>
</Card>
```

---

## Transaction Flows

### Send Transaction

Token transfer form with confirmation.

```tsx
{/* Step 1: Input */}
{step === 'input' && (
  <Card variant="default" className="p-4">
    <Heading4 className="!font-mono mb-4">Send</Heading4>

    <div className="space-y-4">
      <Input
        label="Recipient Address"
        placeholder="Enter wallet address"
        value={recipient}
        onChange={(e) => setRecipient(e.target.value)}
      />

      <div>
        <label className="block text-sm font-medium mb-2">Amount</label>
        <div className="flex gap-2">
          <Input
            type="number"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            wrapperClassName="flex-1"
          />
          <Button variant="ghost" onClick={handleMax}>Max</Button>
        </div>
        <Body5 className="text-text-tertiary mt-1">
          Balance: {balance} THRU
        </Body5>
      </div>

      <Button
        variant="primary"
        size="lg"
        className="w-full"
        onClick={() => setStep('confirm')}
        disabled={!isValid}
      >
        Continue
      </Button>
    </div>
  </Card>
)}

{/* Step 2: Confirm */}
{step === 'confirm' && (
  <Card variant="default" className="p-4">
    <Heading4 className="!font-mono mb-4">Confirm Send</Heading4>

    <div className="space-y-3 mb-6">
      <SummaryDatum label="To" value={<Ui4>{truncate(recipient)}</Ui4>} />
      <SummaryDatum label="Amount" value={<Ui4>{amount} THRU</Ui4>} />
      <SummaryDatum label="Fee" value={<Ui4>~0.00001 THRU</Ui4>} />
    </div>

    <div className="flex gap-3">
      <Button variant="outline" className="flex-1" onClick={() => setStep('input')}>
        Back
      </Button>
      <Button variant="primary" className="flex-1" onClick={handleSend}>
        Confirm & Send
      </Button>
    </div>
  </Card>
)}
```

### Transaction Result

Success/failure display after transaction.

```tsx
<Card variant="default" className="p-6 text-center">
  {status === 'confirmed' ? (
    <>
      <div className="w-16 h-16 bg-grass-100 flex items-center justify-center mx-auto mb-4">
        <CheckCircle className="h-8 w-8 text-grass-400" />
      </div>
      <Heading4 bold className="mb-2">Transaction Confirmed</Heading4>
      <Body4 className="text-text-secondary mb-4">
        Your transaction has been successfully processed.
      </Body4>
    </>
  ) : (
    <>
      <div className="w-16 h-16 bg-brick-100 flex items-center justify-center mx-auto mb-4">
        <XCircle className="h-8 w-8 text-brick-400" />
      </div>
      <Heading4 bold className="mb-2">Transaction Failed</Heading4>
      <Body4 className="text-text-secondary mb-4">
        {errorMessage}
      </Body4>
    </>
  )}

  {signature && (
    <div className="bg-surface-lower p-3 mb-4">
      <Body5 className="text-text-tertiary mb-1">Transaction ID</Body5>
      <div className="flex items-center justify-center gap-2">
        <Ui4 className="truncate max-w-[200px]">{signature}</Ui4>
        <CopyButton text={signature} />
      </div>
    </div>
  )}

  <div className="flex gap-3">
    <Button variant="outline" className="flex-1" onClick={handleViewExplorer}>
      View in Explorer
    </Button>
    <Button variant="primary" className="flex-1" onClick={handleDone}>
      Done
    </Button>
  </div>
</Card>
```

---

## Empty & Error States

### Empty State

No data available message.

```tsx
<Card variant="default" className="p-8 text-center">
  <div className="text-text-tertiary mb-4">
    <InboxIcon className="h-12 w-12 mx-auto" />
  </div>
  <Heading5 className="text-text-secondary mb-2">No Transactions Yet</Heading5>
  <Body4 className="text-text-tertiary mb-4">
    Your transaction history will appear here once you make your first transfer.
  </Body4>
  <Button variant="primary" onClick={handleSendFirst}>
    Send Your First Transaction
  </Button>
</Card>
```

### Error State

Error message with retry option.

```tsx
<Card variant="default" className="p-8 text-center">
  <div className="text-brick-400 mb-4">
    <AlertCircle className="h-12 w-12 mx-auto" />
  </div>
  <Heading5 className="text-text-primary mb-2">Something Went Wrong</Heading5>
  <Body4 className="text-text-secondary mb-4">
    We couldn't load this data. Please try again.
  </Body4>
  <Button variant="outline" onClick={handleRetry}>
    Try Again
  </Button>
</Card>
```

### Not Found

404-style not found message.

```tsx
<div className="min-h-[400px] flex items-center justify-center">
  <Card variant="default" className="p-8 text-center max-w-md">
    <Heading4 bold className="mb-2">Not Found</Heading4>
    <Body4 className="text-text-secondary mb-4">
      The {entityType} you're looking for doesn't exist or may have been removed.
    </Body4>
    <Button variant="primary" onClick={() => router.push('/')}>
      Go Home
    </Button>
  </Card>
</div>
```

### Loading State

Full-page loading indicator.

```tsx
<div className="min-h-[400px] flex items-center justify-center">
  <div className="text-center">
    <Loader2 className="h-8 w-8 animate-spin text-text-tertiary mx-auto mb-4" />
    <Body4 className="text-text-secondary">Loading...</Body4>
  </div>
</div>
```
