# @thru/passkey

WebAuthn passkey registration and signing for Thru apps across browser, popup, React Native, and server.

## Installation

```bash
npm install @thru/passkey
```

## Entry Points

- `@thru/passkey/web` - browser/WebAuthn registration and signing
- `@thru/passkey/popup` - popup bridge/protocol helpers for embedded browser flows
- `@thru/passkey/mobile` - React Native/mobile passkey and secure-storage helpers
- `@thru/passkey/auth` - higher-level app auth/store helpers
- `@thru/passkey/server` - backend wallet/challenge/submit helpers

## Deprecated Root Import

The root import path is deprecated:

```typescript
import { registerPasskey } from '@thru/passkey';
```

Use explicit entry points instead:

```typescript
import { registerPasskey } from '@thru/passkey/web';
```

The root path remains as a temporary compatibility shim and will be removed after downstream consumers migrate.

## Browser Usage

This package requires a browser environment with WebAuthn support (`navigator.credentials`).

### Register a Passkey

```typescript
import { registerPasskey } from '@thru/passkey/web';

const result = await registerPasskey('alice', 'user-id-123', 'example.com');
```

### Sign with a Known Credential

```typescript
import { signWithPasskey } from '@thru/passkey/web';

const challenge = new Uint8Array(32);
const result = await signWithPasskey(credentialId, challenge, 'example.com');
```

### Sign with a Stored Passkey

```typescript
import { signWithStoredPasskey } from '@thru/passkey/web';
import type { PasskeyMetadata, PasskeyPopupContext } from '@thru/passkey/web';

const preferredPasskey: PasskeyMetadata | null = null;
const allPasskeys: PasskeyMetadata[] = [];
const context: PasskeyPopupContext = {
  appName: 'My App',
  origin: 'https://app.example.com',
};

const result = await signWithStoredPasskey(
  challenge,
  'example.com',
  preferredPasskey,
  allPasskeys,
  context
);
```

### Capability Detection

```typescript
import {
  isWebAuthnSupported,
  preloadPasskeyClientCapabilities,
  getPasskeyClientCapabilities,
  shouldUsePasskeyPopup,
} from '@thru/passkey/web';
```

## Popup Bridge

Use the popup helpers when your browser app needs a separate approval window for embedded or iframe-based passkey flows.

### Parent Side

```typescript
import {
  openPasskeyPopupWindow,
  requestPasskeyPopup,
  closePopup,
  PASSKEY_POPUP_PATH,
  PASSKEY_POPUP_CHANNEL,
} from '@thru/passkey/popup';
```

### Popup Window Side

```typescript
import {
  buildSuccessResponse,
  decodeChallenge,
  getResponseError,
  toPopupSigningResult,
} from '@thru/passkey/popup';
```

Communication between parent and popup uses `postMessage` with `BroadcastChannel` as a fallback. The popup path defaults to `/passkey/popup`.

## Browser Convenience Exports

`@thru/passkey/web` re-exports the browser-side encoding and crypto helpers used by the wallet today, including:

- `bytesToHex`
- `hexToBytes`
- `bytesToBase64`
- `bytesToBase64Url`
- `base64UrlToBytes`
- `arrayBufferToBase64Url`
- `base64UrlToArrayBuffer`

## Types

Key web types exported from `@thru/passkey/web`:

- `PasskeyRegistrationResult`
- `PasskeySigningResult`
- `PasskeyDiscoverableSigningResult`
- `PasskeyStoredSigningResult`
- `PasskeyMetadata`
- `PasskeyClientCapabilities`
- `PasskeyPopupContext`

Key popup types exported from `@thru/passkey/popup`:

- `PasskeyPopupRequest`
- `PasskeyPopupResponse`
- `PasskeyPopupSigningResult`
- `PasskeyPopupStoredSigningResult`
- `PasskeyPopupAccount`

### Embedded browser recovery

Delegate `publickey-credentials-get` and `publickey-credentials-create` to the
exact wallet origin in the host's Permissions-Policy header and iframe `allow`
attribute. Unknown browser capability APIs do not prevent inline ceremonies.
WebKit cross-origin creation and confirmed iframe restrictions require an
explicit user action to continue in a popup; cancellation and generic security
errors never trigger automatic popup fallback. A frame whose top-level page is
`http://localhost` (or another loopback address) also continues in a popup,
reason `insecure-host`, because browsers refuse WebAuthn there; a localhost
wallet frame stays inline. Under any other HTTP page the frame is not a secure
context, so every ceremony fails closed with "Passkeys require a secure HTTPS
connection."

Hosted integrations can register `setPasskeyRecoveryHandler(handler, reporter)`
from `@thru/passkey/web`. Render the request's `retry` and `cancel` actions in
existing wallet UI. Call `retry` directly from a click handler: it opens the
window synchronously and resumes only the pending ceremony. Keep the request's
original approval mounted until completion. The returned cleanup function aborts
pending work. `cancelPasskeyCeremony()` also cancels on host dismissal.

Without a recovery handler, restricted calls reject with
`PasskeyIframeRestrictionError` (`action` and `reason`). All browser registration
and signing functions accept `promptMode: 'auto' | 'inline' | 'popup'`,
`allowPopupFallback`, and `signal`. Explicit `popup` mode must be called from a
user interaction. `allowPopupFallback: false` always prohibits popup routing,
including when `promptMode: 'popup'` is supplied.

Only one ceremony can run per document. A failed assertion does not automatically
retry after a focus error or ambiguous cancellation. Show an explicit retry in
the existing approval UI. Missing stored credentials can use discoverable
sign-in; popup recovery preserves the requested RP ID and selected credential.
