## Account Selection Flow

```mermaid
sequenceDiagram
    autonumber
    participant Dapp
    participant SDK as BrowserSDK
    participant Host as EmbeddedProvider
    participant Iframe as Wallet Iframe
    participant Worker

    Dapp->>SDK: selectAccount(publicKey)
    SDK->>Host: selectAccount(publicKey)
    Host->>Iframe: postMessage(select_account)
    Iframe->>Worker: switch signer
    Worker-->>Iframe: success / failure
    Iframe-->>Host: { account } or error
    alt success
        Host->>SDK: emit accountChanged(account)
        SDK->>Dapp: accountChanged(account)
    else failure
        Host->>SDK: error (ACCOUNT_NOT_FOUND, ...)
        SDK->>Dapp: propagate failure
    end
```

**Notes**

- If the wallet cannot locate the requested public key, it responds with an `ACCOUNT_NOT_FOUND` error and leaves the current selection unchanged.
- Successful selections are broadcast via the `accountChanged` event so every consumer stays in sync without polling.
