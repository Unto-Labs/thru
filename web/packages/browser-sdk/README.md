# @thru/browser-sdk

Low-level browser SDK for embedding the Thru wallet experience. It manages the iframe-based embedded provider, forwards lifecycle events, and exposes a ready-to-use `Thru` RPC client alongside wallet account management utilities.

## Installation

```bash
npm install @thru/browser-sdk
```

## Basic Usage

```ts
import { BrowserSDK } from '@thru/browser-sdk';

// Configure the wallet iframe location and the RPC endpoint to talk to
const sdk = new BrowserSDK({
  iframeUrl: 'https://thru-wallet.up.railway.app/embedded',
  rpcUrl: 'https://grpc-web.alphanet.thruput.org',
});

await sdk.initialize(); // injects the iframe once

// Observe lifecycle events
sdk.on('connect', ({ accounts }) => {
  console.log('Connected accounts', accounts);
});
sdk.on('disconnect', () => console.log('Wallet disconnected'));
sdk.on('error', (err) => console.error('Wallet error', err));

// Trigger the wallet connect flow
const result = await sdk.connect();
const primary = result.accounts[0];

// Use the embedded Thru RPC client
const thru = sdk.getThru();
const account = await thru.accounts.get(primary.address);

// Disconnect when finished
await sdk.disconnect();
```

### Key Capabilities

- Handles iframe creation and cleanup (`initialize`, `destroy`)
- Connection helpers (`connect`, `disconnect`, `isConnected`, `selectAccount`)
- Event emitter for wallet state changes (`connect`, `disconnect`, `lock`, `error`, `accountChanged`)
- Access to a typed Thru RPC client via `sdk.getThru()` for querying on-chain data or submitting transactions
