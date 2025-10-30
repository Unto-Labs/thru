# @thru/thru-sdk

Typed TypeScript/JavaScript client for talking to the Thru blockchain. It wraps the public gRPC-Web endpoints and bundles helpers for working with blocks, accounts, transactions, proofs, and typed identifiers.

## Installation

```bash
npm install @thru/thru-sdk
```

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

### Modules at a Glance

- `thru.blocks` — query finalized or raw blocks and stream height information
- `thru.accounts` — fetch account state, list owned accounts, and generate create-account transactions
- `thru.transactions` — build transactions locally, sign them, submit, and inspect status
- `thru.events` / `thru.proofs` — retrieve on-chain events and generate state proofs
- `thru.helpers` — convert to/from Thru identifiers (addresses, signatures, block hashes) and derive program addresses
