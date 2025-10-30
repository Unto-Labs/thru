# @thru/react-ui

Headless-friendly React UI components built on top of `@thru/react-sdk`. These components provide polished wallet experiences that wire up to the shared Thru provider with zero additional state management.

## Installation

```bash
npm install @thru/react-ui
```

> Requires `@thru/react-sdk` and React 18+ as peer dependencies.

## Basic Usage

```tsx
import { ThruProvider } from '@thru/react-sdk';
import { ThruAccountSwitcher } from '@thru/react-ui';

function WalletBar() {
  return (
    <header style={{ display: 'flex', justifyContent: 'flex-end', padding: '1rem' }}>
      <ThruAccountSwitcher />
    </header>
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
      <WalletBar />
      {/* rest of your app */}
    </ThruProvider>
  );
}
```

`ThruAccountSwitcher` automatically handles:

- Launching the wallet connect modal when the user clicks the button
- Showing connection progress and the active account address
- Listing connected accounts and updating the selection with `useAccounts()` and `useWallet()` under the hood
