# Thru Wallet Platform Architecture

_Last updated: 2025-10-10_

This document captures the current end-to-end architecture across the Thru Wallet
monorepo, covering the SDK packages, the wallet application, and supporting
tooling. It reflects the code in this repository as of the date above and
highlights known gaps between the intended design and the implementation.

---

## 1. High-Level View

```
dApp (React, Vue, etc.)
  └─ @thru/react-sdk (ThruProvider + hooks)
      └─ @thru/browser-sdk (BrowserSDK facade)
          └─ @thru/embedded-provider (Iframe + postMessage transport)
              └─ wallet/app/embedded (Next.js iframe surface)
                  └─ WalletProvider (React context)
                      └─ workerClient (main-thread proxy)
                          └─ signer.worker.ts (KeyManager + base64 Thru signing)
                              ├─ @thru/crypto (mnemonic, HD wallet, AES-GCM)
                              ├─ @thru/indexed-db-stamper (IndexedDB storage)
                              └─ Thru RPC client
```

The wallet runs both as a standalone Next.js application and as an embeddable
iframe surface consumed by the SDK stack. All signing and mnemonic handling is
isolated inside a dedicated Web Worker to keep secrets out of the main UI
thread.

---

## 2. Workspace Structure

| Area | Purpose | Key paths |
| --- | --- | --- |
| `thru-wallet-sdk/` | PNPM workspace with published SDK packages. | `packages/browser-sdk`, `packages/react-sdk`, `packages/embedded-provider`, `packages/crypto`, `packages/indexed-db-stamper`, `packages/chain-interfaces`, `packages/react-ui` (stub) |
| `wallet/` | Next.js wallet application used standalone and inside the iframe. | `app/**`, `src/contexts/WalletProvider.tsx`, `src/lib`, `src/workers` |
| `test-dapp/` | Example Next.js dApp that integrates the React SDK. | `src/app/providers.tsx`, `src/app/page.tsx` |
| `docs/` | Architecture & migration documentation (this file). | `docs/system-architecture.md` |

Each package in `thru-wallet-sdk` ships its own `tsup` build, TypeScript config,
and exports ES modules suitable for bundlers.

---

## 3. Runtime Architecture

### 3.1 React SDK (`@thru/react-sdk`)

- `ThruProvider` (`thru-wallet-sdk/packages/react-sdk/src/ThruProvider.tsx`)
  instantiates a `BrowserSDK`, eagerly calls `initialize()` to mount the iframe,
  and wires SDK events into React state (`isConnected`, `addresses`, `isConnecting`,
  `error`).
- Hooks (`useConnect`, `useAccounts`, `useThruChain`, `useDisconnect`) expose
  primitives to dApps and delegate to the underlying `BrowserSDK`.
- The provider keeps a single SDK instance for the lifetime of the React tree;
  it destroys the SDK on unmount.

### 3.2 Browser SDK (`@thru/browser-sdk`)

- `BrowserSDK` (`packages/browser-sdk/src/BrowserSDK.ts`) wraps an
  `EmbeddedProvider` with a simplified API for dApps.
- Responsibilities:
  - Ensure `initialize()` is called before any other method.
  - Expose `connect`, `disconnect`, `isConnected`, `getAddresses`, and the Thru
    chain accessor (`thru`).
  - Translate provider events into a minimal event emitter (`connect`,
    `disconnect`, `lock`, `error`).
- Consumers can destroy the SDK to clean up the iframe and listeners.

### 3.3 Embedded Provider (`@thru/embedded-provider`)

- `EmbeddedProvider` (`packages/embedded-provider/src/EmbeddedProvider.ts`)
  orchestrates the iframe lifecycle, connection state, and event fan-out.
- `IframeManager` (`packages/embedded-provider/src/IframeManager.ts`) creates the
  hidden iframe (~full-screen overlay), waits for an `iframe:ready` postMessage,
  manages request/response matching with 30 s timeouts, and forwards event
  broadcasts shaped as `{ type: 'event', event, data }`.
- `EmbeddedThruChain` implements `IThruChain`, relays base64-encoded Thru
  transactions to the iframe, and exposes chain-specific helpers.
- Default iframe URL is `https://wallet.thru.io/embedded`; dApps override it for
  local development (e.g., the test dApp points at `http://localhost:3000/embedded`).

### 3.4 Wallet iframe surface (`wallet/app/embedded/page.tsx`)

- React component that renders the modal UI used when the wallet is embedded.
- Subscribes to the main wallet context (`useWallet`) so it shares state with the
  standalone app (accounts, unlock status, account selection).
- Handles incoming requests: `connect`, `disconnect`, `signTransaction`, and
  `getAccounts`.
- Maintains a `pendingRequest` record to persist request metadata across modal
  interactions.
- Calls `workerClient.signSerializedTransaction` for signing.
- Emits responses and events back to the parent via `window.parent.postMessage`
  using the `{ type: 'event', event }` convention.

### 3.5 Wallet React core (`wallet/src/contexts/WalletProvider.tsx`)

- Provides the top-level context for the wallet UI and the embedded page.
- Coordinates IndexedDB storage, the worker client, and network state.
- Responsibilities:
  - Detect existing wallets and load account metadata from IndexedDB.
  - Unlock the worker by supplying the encrypted seed and password.
  - Derive accounts via the worker and persist them through `AccountStorage`.
- Track balances through a thin Thru client wrapper (`wallet/src/lib/thru/client.ts`).
  - Perform transfers by building transactions in the main thread and delegating
    signing to the worker.
- Exposes imperative APIs such as `createWallet`, `unlockWallet`, `createAccount`,
  `sendTransfer`, etc., to any React component in the tree.

### 3.6 Web Worker, Key Management, and Crypto

- `workerClient` (`wallet/src/lib/worker/worker-client.ts`) multiplexes requests
  over `postMessage`, tracks outstanding promises, and enforces a 30 s timeout.
- `signer.worker.ts` dispatches typed requests (unlock, lock, derive, sign, etc.)
  to the `KeyManager` (`wallet/src/workers/key-manager.ts`).
- `KeyManager` keeps the decrypted seed solely in worker memory, resets an
  inactivity timer (15 min) on every operation, and relies on `@thru/crypto` for:
  - `MnemonicGenerator` (BIP39 generation and validation).
- `ThruHDWallet` (derive Thru ed25519 key material and encoded addresses).
  - `EncryptionService` (AES-GCM with scrypt-derived keys; serialize/deserialize
    helpers for storage).
- Signing flows:
  - Main thread constructs instructions using Gill helpers, producing a canonical
    structure or serialized transaction.
  - The worker injects the signer keypair, signs using Gill or web3.js utilities,
    and returns results (base64 payloads or Gill `TransactionWithLifetime`).

### 3.7 Storage & Network Integration

- `@thru/indexed-db-stamper` exposes `WalletStorage` and `AccountStorage`
  abstractions backed by the `idb` library and an `IndexedDB` schema (`wallet`
  store for encrypted seeds, `settings` for future use).
- Encrypted seed blobs are serialized via `EncryptionService.serialize()` before
  writing to IndexedDB.
- `ThruClient` (`wallet/src/lib/thru/client.ts`) is a Thru RPC wrapper supplying
  balance lookups while signing occurs in the worker.
  that surfaces balance checks and transaction submission across the supported
  networks (`mainnet-beta`, `testnet`, `devnet`, `localnet`).
- `TransactionBuilder` contains format helpers such as `solToLamports` and
  address validation that complement the worker signing flow.

---

## 4. postMessage Protocol (iframe ↔ SDK)

### 4.1 Request/Response Messages

| Request | Implemented? | Notes |
| --- | --- | --- |
| `connect` | ✅ | Triggers modal; requires unlock before success. |
| `disconnect` | ✅ | Clears local state and emits `event:disconnect`. |
| `signMessage` | 🚧 | Not yet handled in `wallet/app/embedded/page.tsx`. |
| `signTransaction` | ✅ | Signs serialized transactions via worker. |
| `signAndSendTransaction` | 🚧 | Handled as `signTransaction` but sending step is TODO. |
| `getAccounts` | ✅ | Returns currently connected addresses. |
| `signMessage` | 🚧 | Not yet handled by the iframe surface. |

Responses follow the `{ id, success, result?, error? }` contract defined in
`packages/embedded-provider/src/types/messages.ts`.

### 4.2 Events

- The iframe sends broadcasts shaped as `{ type: 'event', event: '<name>', data }`.
- `IframeManager.handleEvent` forwards each event (`connect`, `disconnect`,
  `lock`, `error`, etc.) to the `EmbeddedProvider`, which then raises SDK events.
- Implemented events today: `connect`, `disconnect` (emitted on approval and
  manual disconnect). `account_changed`, `network_changed`, and `lock` are not
  yet produced by the wallet UI.

### 4.3 Readiness & Lifecycle

1. `IframeManager.createIframe()` injects the iframe and attaches a global
   `message` listener.
2. The embedded page immediately posts `{ type: 'iframe:ready' }`; the manager
  verifies the origin and resolves initialization.
3. All subsequent requests include the parent window origin for future origin
  validation (not yet enforced on the wallet side).

---

## 5. Security & Isolation Model

- **Worker isolation:** Private keys and decrypted seeds never leave the
  `SignerWorker`. All signing is performed with Gill or web3.js inside the worker.
- **Encryption at rest:** Seeds are AES-GCM encrypted with scrypt-derived keys
  (`@thru/crypto/EncryptionService`) before hitting IndexedDB.
- **Auto-lock:** `KeyManager` clears seed material and zeroizes buffers after
  15 minutes of inactivity. (Propagating the locked status back to the React
  layer is still pending.)
- **Origin checks:** `IframeManager` validates response origins against the
  configured iframe URL. The embedded page currently trusts all origins when
  receiving messages and targets `'*'` when responding; this should be tightened
  when the embedding host list is finalized.
- **Global polyfills:** `GlobalPolyfill` ensures `window.global` exists so Node-
  oriented crypto dependencies function in the browser context.

---

## 6. Developer Experience & Local Testing

- **React integration:** Developers wrap their app with `ThruProvider`, then use
  hooks like `useConnect`, `useAccounts`, and `useThruChain`. The sample dApp
  (`test-dapp/src/app/page.tsx`) currently demonstrates connecting and listing
  addresses while transaction builders are brought online.
- **Iframe endpoint:** During development, point the SDK at a locally running
  wallet: `iframeUrl: 'http://localhost:3000/embedded'`.
- **Standalone wallet:** Navigating the wallet directly (e.g., `/accounts`) uses
  the same `WalletProvider` context, so features built for standalone carry over
  to the embedded experience.
- **Build tooling:** Each SDK package is bundled with `tsup`, and the monorepo is
  orchestrated by PNPM/Turborepo. The wallet app remains a standard Next.js app.

---

## 7. Known Gaps & Mismatches

| Issue | Location | Notes |
| --- | --- | --- |
| `signMessage` requests are unhandled in the iframe. | `wallet/app/embedded/page.tsx:154` | SDK exposes this method, so callers currently receive timeouts. |
| Message origin validation is one-sided. | `wallet/app/embedded/page.tsx:144` | Should verify `event.origin` and respond to a specific origin rather than `'*'`. |
| `@thru/react-ui` package is still a stub. | `thru-wallet-sdk/packages/react-ui/src/index.ts` | No UI components or modal infrastructure yet. |

Addressing these gaps will bring the implementation in line with the migration
plan and enable a more Phantom-like developer experience.

---

## 8. Future Enhancements (per migration roadmap)

- Finish Phase 6/7 tasks:
  - Implement the remaining postMessage handlers and event broadcasts.
  - Build the `@thru/react-ui` layer (modals, UI components).
  - Produce the integration guide, API reference, and example app upgrades.
- Harden security posture:
  - Restrict allowed parent origins for iframe communication.
  - Emit explicit lock events when the worker auto-locks.
  - Expand test coverage around the postMessage protocol and worker flows.
- Extend chain support:
  - Leverage `@thru/chain-interfaces` to add additional chain adapters when ready.

This document should be revisited as those enhancements land to keep the
architecture reference accurate.
