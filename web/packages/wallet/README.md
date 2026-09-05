# @thru/wallet

Passkey-native embedded wallet SDK for Thru.

The package manages the iframe-based embedded provider, forwards lifecycle events, and exposes a ready-to-use `Thru` RPC client alongside wallet account management utilities.

## Installation

```bash
npm install @thru/wallet
```

## Basic Usage

```ts
import { BrowserSDK } from '@thru/wallet';

// Configure the wallet iframe location and the RPC endpoint to talk to
const sdk = new BrowserSDK({
  iframeUrl: 'https://app.tid.sh/embedded',
  rpcUrl: 'https://rpc.alphanet.thru.org',
  // Default: true. Set false to stop all SDK and hosted-wallet telemetry.
  telemetryEnabled: true,
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

## React Native

React Native apps use the native wallet entrypoints from this same package:

```tsx
import { ThruProvider, ThruWalletSheet } from '@thru/wallet/native/react';

export default function Root() {
  return (
    <ThruProvider config={{ walletUrl: 'https://app.tid.sh/embedded' }}>
      <App />
      <ThruWalletSheet />
    </ThruProvider>
  );
}
```

Expo apps should install the config plugin from `@thru/wallet/native/plugin`.
The SDK trusts both production wallet hosts: `app.tid.sh` and `wallet.tid.sh`.

## Operational telemetry

`telemetryEnabled` controls privacy-safe operational diagnostics for both the
SDK bridge and the hosted wallet. It defaults to `true` for browser and React
Native integrations:

```ts
const sdk = new BrowserSDK({
  telemetryEnabled: false,
});
```

React Native uses the same option in `ThruProvider`'s `config` object.

When enabled, the SDK sends best-effort event batches directly to the hosted
wallet's `/v1/telemetry` endpoint. Telemetry failures never block or fail a
wallet operation. Events can include SDK and wallet versions, app origin,
platform, network, request stage and duration, random diagnostic session ID,
iframe/WebView frame and request IDs, error codes, public wallet and program
addresses, and public transaction signatures. Successful and failed sessions
are collected without sampling.

Telemetry never includes private or session keys, passkey assertions or
credential IDs, authentication headers, cookies or tokens, raw or signed
transactions, instruction data/bytes, account data/contents, amounts, balances,
or URL query and fragment data. Error messages are bounded and sanitized before
they enter the in-memory queue. No persistent client queue is created.

Setting `telemetryEnabled: false` prevents collection, queueing, and upload in
the SDK and passes the opt-out into the hosted wallet. Developer console output
is separate from telemetry and is not controlled by this option.

### Cloud Logging operations

Telemetry ingestion emits structured Cloud Logging records tagged with
`telemetryType="thru_wallet"`. Useful filters add one of these fields:

```text
jsonPayload.telemetryType="thru_wallet"
jsonPayload.sessionId="<diagnostic-session-id>"
```

Replace `sessionId` with `appOrigin`, `walletAddress`, `requestId`,
`transactionSignature`, or `errorCode` to investigate a particular integration
or operation. Configure the deployment's Cloud Logging bucket for 30-day
retention; the SDK and ingestion code do not set logging-bucket retention.
The ingestion endpoint is intentionally credential-free, so production rollout
must also place a request-rate or quota policy in front of `/v1/telemetry` to
limit forged traffic and log-volume abuse.

Deploy and verify the ingestion route before publishing an SDK version that
sends telemetry.

## Legacy transaction signing

Embedded integrations targeting a pre-cutover network can explicitly configure
legacy outer-transaction signing:

```tsx
import { TransactionSigningScheme } from '@thru/wallet';

const config = {
  walletUrl: 'https://app.tid.sh/embedded/native/transparent',
  transactionSigningScheme: TransactionSigningScheme.Legacy,
};
```

The setting is fixed for the SDK instance and propagated to the hosted wallet.
RFC-8032 remains the default, and no automatic fallback is performed.
