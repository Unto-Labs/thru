# @thru/react-sdk

React bindings for the Thru browser wallet. The package wraps `@thru/browser-sdk`, exposes context providers, and ships hooks for accessing connection state, accounts, and the typed Thru RPC client inside React applications.

## Installation

```bash
npm install @thru/react-sdk
```

> **Note:** React 18+ is required (declared as a peer dependency).

## Basic Usage

```tsx
import { ThruProvider, useWallet, useAccounts } from '@thru/react-sdk';

function WalletPanel() {
  const { connect, disconnect, isConnected, isConnecting } = useWallet();
  const { accounts, selectedAccount } = useAccounts();

  if (!isConnected) {
    return (
      <button onClick={() => connect()} disabled={isConnecting}>
        {isConnecting ? 'Connecting…' : 'Connect Thru Wallet'}
      </button>
    );
  }

  return (
    <section>
      <p>Selected account: {selectedAccount?.address}</p>
      <ul>
        {accounts.map((account) => (
          <li key={account.address}>{account.address}</li>
        ))}
      </ul>
      <button onClick={() => disconnect()}>Disconnect</button>
    </section>
  );
}

export function App() {
  return (
    <ThruProvider
      config={{
        iframeUrl: 'https://thru-wallet.up.railway.app/embedded',
        rpcUrl: 'https://grpc-web.alphanet.thruput.org',
      }}
    >
      <WalletPanel />
    </ThruProvider>
  );
}
```

The provider creates a shared `BrowserSDK` instance and exposes:

- `useWallet()` — connect/disconnect helpers plus access to the embedded provider API
- `useAccounts()` — subscribe to accounts and the current selection
- `useThru()` — raw context (including the underlying `BrowserSDK` and the `Thru` RPC client for data queries)
