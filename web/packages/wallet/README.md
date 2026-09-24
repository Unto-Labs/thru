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
- Restores a remembered connection on `initialize()`. The wallet issues a small non-secret restore record with every authorized connection, which the SDK keeps in your origin's storage next to the selected address; on WebKit (Safari, iOS home-screen web apps) the wallet frame's own storage does not survive a quit, and that record is what lets the next launch reconnect without a passkey. Signing still prompts for the passkey once per launch. `connection.hasRememberedConnection()` answers synchronously whether a launch holds a record to restore from, so a host can open its signed-in shell before the wallet has replied. The record is cleared by `disconnect()` before the wallet is asked and comes back only if the wallet answers that the user cancelled the sign-out; a lost answer, a timeout or a revoke error leaves it cleared, so the worst case is one extra passkey on the next launch, never a session the user had left. It is also cleared by a sign-out inside the wallet and when the wallet refuses it. The record proves nothing by itself: a session rebuilt from one is read-only until a passkey ceremony proves the account is the user's, which the first signing or Add funds runs.
- Event emitter for wallet state changes (`connect`, `disconnect`, `lock`, `error`, `accountChanged`)
- Access to a typed Thru RPC client via `sdk.getThru()` for querying on-chain data or submitting transactions

### Serve your app over HTTPS

Browsers block passkeys inside the wallet iframe when your page uses plain
HTTP, even `http://localhost` (Chrome reports "TLS certificate errors"). On a
localhost HTTP page the wallet continues passkey prompts in a new window; on
any other HTTP address passkeys are unavailable. The SDK logs a console
warning in both cases. Serve your app over HTTPS in development, for example
with `next dev --experimental-https` or `vite-plugin-mkcert`. See
[Serve your app over HTTPS in development](https://thru.org/docs/wallet/embedded-wallet-integration/#serve-your-app-over-https-in-development).

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

## Theme

The wallet's sheets, menus and account button draw for the host page's color
scheme. Pass `light`, `dark`, or `system` to follow the OS setting; the default
is `light`. Changes apply live: open and future wallet surfaces restyle in
place, and the wallet is not reloaded.

```tsx
import { ThruProvider } from '@thru/wallet/react';

<ThruProvider config={config} theme={isDark ? 'dark' : 'light'}>
  <App />
</ThruProvider>;
```

React Native takes the same `theme` prop on `ThruProvider` from
`@thru/wallet/native/react`, where `system` follows the device appearance.
`config.theme` is still read as the initial value; the top-level prop wins.

Outside React:

```ts
const sdk = new BrowserSDK({ theme: 'system' });

sdk.setTheme('dark');
sdk.getTheme(); // resolved: 'light' | 'dark'
sdk.getThemePreference(); // as requested: 'light' | 'dark' | 'system'
sdk.on('themeChanged', (theme) => console.log('wallet now draws', theme));
```

A `NativeSDK` used without `ThruProvider` resolves `system` from
`sdk.setSystemTheme(...)`, fed from React Native's `Appearance` API.

- `WalletButton` follows the SDK theme; set its `theme` prop only to pin one
  button (and its menu) to a scheme.
- The deposit screens follow the theme unless `depositUiConfig.appearance` is
  set, which takes precedence.

## Developer mode

Turn on developer mode for builds your team tests with. The wallet then:

- shows the raw error, with a Copy action, on its failure screens;
- runs card purchases on Coinbase's sandbox, so no money moves;
- offers a Test faucet in the web Add funds sheet on alphanet. Its
  `deposit:*` events report `method: 'faucet'`.

It is off by default. The wallet's account menu has its own Developer mode
switch, and either one turns it on: your app can't turn off a developer's own
switch. Changes apply live, without reloading the wallet.

```tsx
<ThruProvider config={config} developerMode={settings.developerMode}>
  <App />
</ThruProvider>;
```

React Native's `ThruProvider` takes the same prop. Outside React, pass
`developerMode` in the config and change it with `sdk.setDeveloperMode(...)`.

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

Replace `sessionId` with `appMode`, `appOrigin`, `walletAddress`, `requestId`,
`transactionSignature`, or `errorCode` to investigate a particular integration
or operation. `appMode` is `pwa` for an installed web app and `browser` for a
regular browser tab. Configure the deployment's Cloud Logging bucket for 30-day
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
