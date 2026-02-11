# @thru/wallet-store

Browser-side IndexedDB storage layer for the Thru wallet. Provides typed helpers for persisting accounts, connected dApps, and passkey profiles in a single unified database. Replaces the legacy `@thru/indexed-db-stamper` package.

## Installation

```bash
pnpm add @thru/wallet-store
```

## Basic Usage

```typescript
import {
  AccountStorage,
  ConnectedAppsStorage,
  loadPasskeyProfiles,
  savePasskeyProfiles,
} from '@thru/wallet-store';

// Save and retrieve accounts
await AccountStorage.saveAccount({
  index: 0,
  label: 'Main',
  publicKey: '...',
  path: "m/44'/501'/0'/0'",
  createdAt: new Date(),
});
const accounts = await AccountStorage.getAccounts();

// Track connected dApps per account
await ConnectedAppsStorage.upsert({
  accountId: 0,
  appId: 'my-dapp',
  origin: 'https://my-dapp.example',
  metadata: { name: 'My dApp', icon: '...' },
});
const apps = await ConnectedAppsStorage.listByAccount(0);

// Manage passkey profiles
const store = await loadPasskeyProfiles();
if (store) {
  await savePasskeyProfiles(store);
}
```

### Key Capabilities

- Single shared IndexedDB database (`thru-wallet` v1) with lazy singleton connection
- **AccountStorage** -- CRUD for HD-derived account metadata (does not store private keys)
- **ConnectedAppsStorage** -- track which dApps are authorized per account, with upsert and indexed lookups
- **Passkey profiles** -- load, save, create, and update WebAuthn passkey profiles with built-in schema migration support
- Pure in-memory transform helpers (`updateProfilePasskey`, `updatePasskeyLastUsed`) that separate mutation from persistence
- SSR-safe: passkey helpers return `null` / `false` when `window` is undefined

## Database Schema

The package opens a single IndexedDB database named `thru-wallet` at version 1 with three object stores:

| Store | Key | Indexes | Purpose |
|---|---|---|---|
| `accounts` | `index` | `by-created` | HD wallet account metadata |
| `connectedApps` | `accountId:appId` | `by-account`, `by-updated` | Authorized dApp connections |
| `passkeyProfiles` | `id` | -- | WebAuthn passkey profiles and settings |

Access the raw database connection when needed:

```typescript
import { getUnifiedDB } from '@thru/wallet-store';

const db = await getUnifiedDB();
```

## API Reference

### AccountStorage

| Method | Description |
|---|---|
| `saveAccount(account)` | Insert or update an account record |
| `getAccounts()` | List all accounts sorted by index |
| `getAccount(index)` | Fetch a single account by its BIP-44 index |
| `updateAccountLabel(index, label)` | Rename an account |
| `getNextAccountIndex()` | Return the next unused account index |
| `hasAccounts()` | Check whether any accounts exist |
| `getAccountCount()` | Return total account count |
| `clearAccounts()` | Delete all account records |

### ConnectedAppsStorage

| Method | Description |
|---|---|
| `upsert(app)` | Insert or update a connected app record |
| `listByAccount(accountId)` | List apps for an account, most recently updated first |
| `get(accountId, appId)` | Fetch a single connection record |
| `remove(accountId, appId)` | Delete a connection |
| `clear()` | Delete all connected app records |

### Passkey Profiles

| Function | Description |
|---|---|
| `loadPasskeyProfiles()` | Load all profiles and settings from IndexedDB |
| `savePasskeyProfiles(store)` | Persist the full profile store (replaces all records) |
| `createDefaultProfileStore()` | Create an in-memory store with one empty default profile |
| `updateProfilePasskey(store, index, passkey)` | Pure transform: attach passkey metadata to a profile |
| `updatePasskeyLastUsed(store, index)` | Pure transform: bump `lastUsedAt` timestamp |

## Dependencies

- [`idb`](https://github.com/jakearchibald/idb) -- Promise-based IndexedDB wrapper
- `@thru/chain-interfaces` -- shared type definitions
