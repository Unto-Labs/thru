# @thru/passkey

Cross-platform passkey helpers for Thru applications.

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
