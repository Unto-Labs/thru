# @thru/thru-sdk

Typed TypeScript/JavaScript client for talking to the Thru blockchain. It wraps the public gRPC-Web endpoints and bundles helpers for working with blocks, accounts, transactions, proofs, and typed identifiers.

## Installation

```bash
npm install @thru/thru-sdk
```

### TypeScript Configuration

For optimal import resolution, we recommend using modern TypeScript module resolution in your `tsconfig.json`:

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

**Why?** The SDK uses modern `exports` fields in `package.json` for better tree-shaking and bundler compatibility. The `bundler` resolution strategy fully supports these modern package exports, while the older `node` resolution may require importing from `dist` paths directly.

If you're using a bundler (Vite, Webpack, esbuild, etc.) or modern build tools, `moduleResolution: "bundler"` is the recommended setting. For Node.js projects, you can also use `"node16"` or `"nodenext"`.

## Basic Usage

```ts
import { createThruClient } from '@thru/thru-sdk';

// Point at the default public alpha cluster or override with your own URL
const thru = createThruClient({
  baseUrl: 'https://grpc-web.alphanet.thruput.org',
});

// Fetch the cluster height and the latest finalized block
const { finalized } = await thru.blocks.getBlockHeight();
const latestBlock = await thru.blocks.get({ slot: finalized });

// Retrieve an account by address (Base58-like strings starting with "ta")
const account = await thru.accounts.get('taExampleAddress...');

// Build, sign, and submit a transaction
const { rawTransaction, signature } = await thru.transactions.buildAndSign({
  feePayer: {
    publicKey: 'taFeePayerAddress...',
    privateKey: feePayerSecretKeyBytes,
  },
  program: programIdentifierBytes,
});
await thru.transactions.send(rawTransaction);
```

### Using Filters

Many SDK functions support CEL (Common Expression Language) filters to query or stream data based on custom expressions evaluated server-side. Filters are constructed using the `create` function from `@bufbuild/protobuf` (already a dependency of `@thru/thru-sdk`).

#### Constructing Filters

```ts
import { create } from "@bufbuild/protobuf";
import { 
  FilterSchema, 
  FilterParamValueSchema,
  type Filter,
  type FilterParamValue 
} from "@thru/thru-sdk";

// Create a filter parameter value
const paramValue = create(FilterParamValueSchema, {
  kind: {
    case: "bytesValue", // or "stringValue", "boolValue", "intValue", "doubleValue"
    value: new Uint8Array(32), // the actual value
  },
});

// Create the filter with a CEL expression
const filter = create(FilterSchema, {
  expression: "meta.owner.value == params.owner_bytes",
  params: {
    owner_bytes: paramValue,
  },
});
```

#### Filter Parameter Value Types

Filter parameters support these types:
- `{ case: "stringValue", value: string }` - for string parameters
- `{ case: "bytesValue", value: Uint8Array }` - for byte array parameters
- `{ case: "boolValue", value: boolean }` - for boolean parameters
- `{ case: "intValue", value: bigint }` - for integer parameters
- `{ case: "doubleValue", value: number }` - for floating-point parameters

#### Functions That Accept Filters

**Query Functions:**
- `thru.accounts.list({ filter })` - List accounts with filtering
- `thru.blocks.list({ filter })` - List blocks with filtering
- `thru.transactions.listForAccount(account, { filter })` - List transactions for an account with filtering

**Streaming Functions:**
- `thru.streaming.streamBlocks({ filter })` - Stream blocks with filtering
- `thru.streaming.streamAccountUpdates(address, { filter })` - Stream account updates with filtering
- `thru.streaming.streamTransactions({ filter })` - Stream transactions with filtering
- `thru.streaming.streamEvents({ filter })` - Stream events with filtering

#### Example: Filtering Accounts by Owner

```ts
// List accounts owned by a specific public key
const ownerBytes = new Uint8Array(32); // your owner pubkey bytes

const ownerParam = create(FilterParamValueSchema, {
  kind: {
    case: "bytesValue",
    value: ownerBytes,
  },
});

const filter = create(FilterSchema, {
  expression: "meta.owner.value == params.owner_bytes",
  params: {
    owner_bytes: ownerParam,
  },
});

const response = await thru.accounts.list({ filter });
```

### Modules at a Glance

- `thru.blocks` — query finalized or raw blocks and stream height information
- `thru.accounts` — fetch account state, list owned accounts, and generate create-account transactions
- `thru.transactions` — build transactions locally, sign them, submit, and inspect status
- `thru.events` / `thru.proofs` — retrieve on-chain events and generate state proofs
- `thru.helpers` — convert to/from Thru identifiers (addresses, signatures, block hashes) and derive program addresses
