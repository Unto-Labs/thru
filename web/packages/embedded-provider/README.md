# @thru/embedded-provider

Client-side provider for embedding the Thru wallet into any web application. Manages an iframe that hosts the wallet UI, communicates with it over `postMessage`, and exposes a simple API for connecting, signing transactions, and managing accounts.

## Installation

```bash
npm install @thru/embedded-provider
```

## Basic Usage

```typescript
import { EmbeddedProvider } from '@thru/embedded-provider';

const provider = new EmbeddedProvider({
  iframeUrl: 'https://wallet.thru.io',
});

// Initialize iframe (must be called before any other operation)
await provider.initialize();

// Connect to wallet (opens modal)
const result = await provider.connect();
console.log(result.accounts);

// Sign a transaction via the Thru chain interface
const signed = await provider.thru.signTransaction(base64EncodedTx);

// Disconnect
await provider.disconnect();

// Cleanup when done
provider.destroy();
```

## API

### `EmbeddedProvider`

Main entry point. Creates and manages the wallet iframe.

#### Constructor

```typescript
new EmbeddedProvider(config: EmbeddedProviderConfig)
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `iframeUrl` | `string` | `DEFAULT_IFRAME_URL` | URL of the hosted wallet application |
| `addressTypes` | `AddressType[]` | `[AddressType.THRU]` | Chain types to enable |

#### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `initialize()` | `Promise<void>` | Create the iframe and wait for it to signal readiness |
| `connect(options?)` | `Promise<ConnectResult>` | Open the wallet modal and request a connection |
| `disconnect()` | `Promise<void>` | Disconnect the current session |
| `isConnected()` | `boolean` | Whether a wallet session is active |
| `getAccounts()` | `WalletAccount[]` | List of connected accounts |
| `getSelectedAccount()` | `WalletAccount \| null` | Currently selected account |
| `selectAccount(publicKey)` | `Promise<WalletAccount>` | Switch the active account |
| `mountInline(container)` | `Promise<void>` | Mount the wallet inline inside a DOM element instead of as a modal |
| `on(event, callback)` | `void` | Subscribe to provider events |
| `off(event, callback)` | `void` | Unsubscribe from provider events |
| `destroy()` | `void` | Remove the iframe and clean up all listeners |

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `thru` | `IThruChain` | Chain-specific interface for signing transactions on the Thru network |

### `EmbeddedThruChain`

Implements `IThruChain`. Accessed via `provider.thru`.

| Method | Returns | Description |
|--------|---------|-------------|
| `connect()` | `Promise<{ publicKey: string }>` | Connect and return the Thru address |
| `disconnect()` | `Promise<void>` | Disconnect |
| `signTransaction(serializedTransaction)` | `Promise<string>` | Sign a base64-encoded transaction, returns the signed result |

### Events

Subscribe with `provider.on(event, callback)`:

- `connect` -- Wallet connected successfully
- `connect:start` -- Connection flow initiated
- `connect:error` -- Connection attempt failed
- `disconnect` -- Wallet disconnected
- `lock` -- Wallet locked by the user
- `account:changed` -- Active account switched
- `ui:show` -- Wallet UI requested to be shown

### Display Modes

The provider supports two display modes:

- **Modal** (default) -- The iframe is appended to `document.body` as a full-screen overlay.
- **Inline** -- The iframe is mounted inside a container element you provide, useful for embedding a connect button directly in your page layout.

```typescript
// Inline mode
const container = document.getElementById('wallet-mount');
await provider.mountInline(container);
```

## Security

The `IframeManager` validates that the iframe URL belongs to a set of trusted origins before loading it. Allowed origins:

- `https://wallet.thru.io`
- `https://wallet.thru.org`
- `https://thru-wallet.up.railway.app`
- `http://localhost` (any port, for development)

Messages are sent with a strict `targetOrigin` and each iframe instance is tagged with a unique frame ID to prevent cross-talk.

## Key Capabilities

- Iframe lifecycle management with automatic readiness detection
- Request/response correlation over `postMessage` with per-request timeouts
- Origin validation to prevent unauthorized wallet iframes
- Modal and inline display modes
- Event-driven architecture for connection state changes
- WebAuthn (passkey) support via iframe `allow` policy
- Chain-specific interfaces via the `IThruChain` abstraction

## Dependencies

- `@thru/chain-interfaces` -- Shared chain interface types (`IThruChain`, `WalletAccount`)
- `@thru/protocol` -- Message type constants, request/response schemas, and helper utilities
