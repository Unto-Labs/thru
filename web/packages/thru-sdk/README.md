# @thru/thru-sdk

Typed TypeScript/JavaScript client for talking to the Thru blockchain. The SDK exposes rich domain models (blocks, accounts, transactions, events, proofs) that hide the underlying protobuf transport.

## Installation

```bash
npm install @thru/thru-sdk
```

### TypeScript Configuration

For optimal import resolution, use modern module resolution:

```json
{
  "compilerOptions": {
    "moduleResolution": "bundler",
    "module": "ESNext",
    "target": "ES2020",
    "isolatedModules": true
  }
}
```

If you rely on Node’s ESM support without a bundler, use `"moduleResolution": "nodenext"`.

## Basic Usage

```ts
import { createThruClient } from "@thru/thru-sdk";
import {
  Account,
  Block,
  ChainEvent,
  Transaction,
  TransactionStatusSnapshot,
} from "@thru/thru-sdk";

const thru = createThruClient({
  baseUrl: "https://grpc-web.alphanet.thruput.org",
});

// Fetch the latest finalized block
const height = await thru.blocks.getBlockHeight();
const latestBlock: Block = await thru.blocks.get({ slot: height.finalized });
console.log(latestBlock.header.blockHash);

// Fetch an account – returns the Account domain object
const account: Account = await thru.accounts.get("taExampleAddress...");
console.log(account.meta?.balance);

// Build, sign, submit, and track a transaction
const { rawTransaction, signature } = await thru.transactions.buildAndSign({
  feePayer: {
    publicKey: "taFeePayerAddress...",
    privateKey: feePayerSecretKeyBytes,
  },
  program: programIdentifierBytes,
});
await thru.transactions.send(rawTransaction);

// Track the transaction – emits domain snapshots
for await (const update of thru.streaming.trackTransaction(signature)) {
  console.log(update.status, update.executionResult?.consumedComputeUnits);
  if (update.statusCode === ConsensusStatus.FINALIZED) break;
}
```

## Domain Models

The SDK revolves around immutable domain classes. They copy mutable buffers, expose clear invariants, and provide conversion helpers where needed.

| API surface | Domain class |
| --- | --- |
| Blocks | `Block`, `BlockHeader`, `BlockFooter` |
| Accounts | `Account`, `AccountMeta`, `AccountData` |
| Transactions | `Transaction`, `TransactionStatusSnapshot`, `TrackTransactionUpdate` |
| Events | `ChainEvent` |
| Proofs | `StateProof` |
| Height | `HeightSnapshot` |
| Node version | `VersionInfo` |

All classes are exported from the root package for easy access:

```ts
import { Block, Account, ChainEvent } from "@thru/thru-sdk";
```

## View Options

When fetching resources, you can control which parts of the resource are returned using view options. This allows you to optimize network usage by only fetching the data you need.

### AccountView

Controls which sections of account resources are returned:

```ts
import { AccountView } from "@thru/thru-sdk";

// Fetch only the account address (lightweight existence check)
const account = await thru.accounts.get(address, {
  view: AccountView.PUBKEY_ONLY,
});

// Fetch only account metadata (balance, flags, owner, etc.)
const account = await thru.accounts.get(address, {
  view: AccountView.META_ONLY,
});

// Fetch only account data bytes (program data)
const account = await thru.accounts.get(address, {
  view: AccountView.DATA_ONLY,
});

// Fetch everything: address, metadata, and data (default)
const account = await thru.accounts.get(address, {
  view: AccountView.FULL,
});
```

| View Option | Returns | Use Case |
| --- | --- | --- |
| `AccountView.PUBKEY_ONLY` | Only the account `address` | Quick existence check |
| `AccountView.META_ONLY` | `address` + `meta` (balance, flags, owner, dataSize, seq, nonce) | Display account summary without data |
| `AccountView.DATA_ONLY` | `address` + `data` (raw bytes) | Fetch program data without metadata |
| `AccountView.FULL` | `address` + `meta` + `data` | Complete account information |

### BlockView

Controls how much of a block resource is returned:

```ts
import { BlockView } from "@thru/thru-sdk";

// Fetch only block header (slot, hash, producer, etc.)
const block = await thru.blocks.get({ slot }, {
  view: BlockView.HEADER_ONLY,
});

// Fetch header and footer (execution status)
const block = await thru.blocks.get({ slot }, {
  view: BlockView.HEADER_AND_FOOTER,
});

// Fetch only block body (transactions)
const block = await thru.blocks.get({ slot }, {
  view: BlockView.BODY_ONLY,
});

// Fetch everything: header, body, and footer (default)
const block = await thru.blocks.get({ slot }, {
  view: BlockView.FULL,
});
```

| View Option | Returns | Use Case |
| --- | --- | --- |
| `BlockView.HEADER_ONLY` | Only block `header` (metadata) | Display block summary without transactions |
| `BlockView.HEADER_AND_FOOTER` | `header` + `footer` (execution status) | Check execution status without transactions |
| `BlockView.BODY_ONLY` | Only block `body` (transactions) | Fetch transactions without header metadata |
| `BlockView.FULL` | `header` + `body` + `footer` | Complete block information |

### TransactionView

Controls how much of a transaction resource is returned:

```ts
import { TransactionView } from "@thru/thru-sdk";

// Fetch only transaction signature
const tx = await thru.transactions.get(signature, {
  view: TransactionView.SIGNATURE_ONLY,
});

// Fetch only transaction header (signature, fee payer, etc.)
const tx = await thru.transactions.get(signature, {
  view: TransactionView.HEADER_ONLY,
});

// Fetch header and body (instructions)
const tx = await thru.transactions.get(signature, {
  view: TransactionView.HEADER_AND_BODY,
});

// Fetch everything: header, body, and execution results (default)
const tx = await thru.transactions.get(signature, {
  view: TransactionView.FULL,
});
```

| View Option | Returns | Use Case |
| --- | --- | --- |
| `TransactionView.SIGNATURE_ONLY` | Only transaction `signature` | Quick existence check |
| `TransactionView.HEADER_ONLY` | Only transaction `header` (signature, fee payer, compute budget) | Display transaction summary without instructions |
| `TransactionView.HEADER_AND_BODY` | `header` + `body` (instructions) | Fetch transaction without execution results |
| `TransactionView.FULL` | `header` + `body` + execution results | Complete transaction information |

**Note:** If no view is specified, the default is `FULL` for all resource types.

## Streaming APIs

Every streaming endpoint yields an async iterable of domain models:

```ts
// Blocks
for await (const { block } of thru.streaming.streamBlocks()) {
  console.log(block.header.slot);
}

// Account updates
for await (const { update } of thru.streaming.streamAccountUpdates("taAddress")) {
  if (update.kind === "snapshot") {
    console.log(update.snapshot.account.meta?.balance);
  }
}

// Events
for await (const { event } of thru.streaming.streamEvents()) {
  console.log((event as ChainEvent).timestampNs);
}

// Transaction tracking
for await (const update of thru.streaming.trackTransaction(signature)) {
  console.log(update.status, update.executionResult?.consumedComputeUnits);
}
```

## Filters

Server-side filtering is supported everywhere via CEL expressions:

```ts
import { create } from "@bufbuild/protobuf";
import {
  FilterSchema,
  FilterParamValueSchema,
} from "@thru/thru-sdk";

const ownerBytes = new Uint8Array(32);
const ownerParam = create(FilterParamValueSchema, {
  kind: { case: "bytesValue", value: ownerBytes },
});

const filter = create(FilterSchema, {
  expression: "meta.owner.value == params.owner_bytes",
  params: { owner_bytes: ownerParam },
});

const accounts = await thru.accounts.list({ filter });
```

Accepted parameter kinds:
- `stringValue`
- `bytesValue`
- `boolValue`
- `intValue`
- `doubleValue`

Functions that take filters:
- List APIs: `thru.accounts.list`, `thru.blocks.list`, `thru.transactions.listForAccount`
- Streams: `thru.streaming.streamBlocks`, `thru.streaming.streamAccountUpdates`, `thru.streaming.streamTransactions`, `thru.streaming.streamEvents`

## Modules Overview

- `thru.blocks` — fetch/stream blocks and height snapshots
- `thru.accounts` — read account state or build create-account transactions
- `thru.transactions` — build, sign, submit, track, and inspect transactions
- `thru.events` — query event history
- `thru.proofs` — generate state proofs
- `thru.streaming` — streaming wrappers for blocks, accounts, transactions, events
- `thru.helpers` — address, signature, and block-hash conversion helpers

The public surface is fully domain-based; reaching for lower-level protobuf structures is no longer necessary.
