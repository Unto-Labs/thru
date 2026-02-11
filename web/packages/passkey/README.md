# @thru/passkey

Browser-only WebAuthn package for passkey registration, signing, and popup-based flows. Built on top of `@thru/passkey-manager` for platform-agnostic crypto and encoding utilities.

## Installation

```bash
npm install @thru/passkey
```

This package requires a browser environment with WebAuthn support (`navigator.credentials`).

## Basic Usage

### Register a Passkey

Create a new P-256 credential bound to the user's platform authenticator:

```typescript
import { registerPasskey } from '@thru/passkey';

const result = await registerPasskey('alice', 'user-id-123', 'example.com');
// result.credentialId  - base64url credential ID
// result.publicKeyX    - hex-encoded P-256 X coordinate
// result.publicKeyY    - hex-encoded P-256 Y coordinate
// result.rpId          - relying party ID
```

### Sign with a Known Credential

Sign a challenge using a specific credential ID:

```typescript
import { signWithPasskey } from '@thru/passkey';

const challenge = new Uint8Array(32); // your challenge bytes
const result = await signWithPasskey(credentialId, challenge, 'example.com');
// result.signature         - 64-byte concatenated r||s (low-S normalized)
// result.signatureR        - 32-byte r component
// result.signatureS        - 32-byte s component
// result.authenticatorData - raw authenticator data
// result.clientDataJSON    - raw client data JSON
```

### Sign with a Stored Passkey

For embedded or iframe contexts where you have stored passkey metadata. Automatically falls back to a popup window when inline WebAuthn is restricted:

```typescript
import { signWithStoredPasskey } from '@thru/passkey';
import type { PasskeyMetadata } from '@thru/passkey';

const result = await signWithStoredPasskey(
  challenge,
  'example.com',
  preferredPasskey,  // PasskeyMetadata | null
  allPasskeys,       // PasskeyMetadata[]
  { appName: 'My App', origin: 'https://app.example.com' }
);
// result includes .passkey metadata for the credential that signed
```

### Sign with a Discoverable Passkey

Let the browser prompt the user to choose from their available passkeys:

```typescript
import { signWithDiscoverablePasskey } from '@thru/passkey';

const result = await signWithDiscoverablePasskey(challenge, 'example.com');
// result.credentialId - the credential the user selected
// result.rpId         - relying party ID
```

## Key Capabilities

- **P-256 (ES256) credential creation** via `navigator.credentials.create` with platform authenticator selection, resident key, and user verification required
- **Three signing modes**: known credential, stored passkey with fallback, and discoverable (browser-prompted)
- **Automatic popup fallback** for iframe/embedded contexts where the Permissions Policy blocks inline WebAuthn
- **Low-S signature normalization** applied to all signing results for protocol compatibility
- **Capability detection** to query WebAuthn support, client capabilities, and determine the optimal prompt mode before signing
- **Re-exports** encoding and crypto utilities from `@thru/passkey-manager` for backward compatibility

## Capability Detection

Check browser support and determine the best prompt mode ahead of time:

```typescript
import {
  isWebAuthnSupported,
  preloadPasskeyClientCapabilities,
  getPasskeyClientCapabilities,
  shouldUsePasskeyPopup,
  isInIframe,
} from '@thru/passkey';

// Quick synchronous check
if (!isWebAuthnSupported()) {
  // WebAuthn not available
}

// Preload capabilities early (e.g., on app init)
preloadPasskeyClientCapabilities();

// Later, read cached or await capabilities
const capabilities = await getPasskeyClientCapabilities();

// Check if a popup is needed for a given action
const needsPopup = await shouldUsePasskeyPopup('get');
```

## Popup Bridge

For applications that host the passkey popup window (e.g., the wallet app), the package provides both the parent-side and popup-side APIs:

### Parent Side

```typescript
import {
  openPasskeyPopupWindow,
  requestPasskeyPopup,
  closePopup,
  PASSKEY_POPUP_PATH,
  PASSKEY_POPUP_CHANNEL,
} from '@thru/passkey';
```

### Popup Window Side

```typescript
import {
  toPopupSigningResult,
  buildSuccessResponse,
  decodeChallenge,
  getPopupDisplayInfo,
  getResponseError,
  signWithPreferredPasskey,
  buildStoredPasskeyResult,
} from '@thru/passkey';
```

Communication between parent and popup uses `postMessage` with `BroadcastChannel` as a fallback. The popup path defaults to `/passkey/popup`.

## Re-exported Utilities

The following are re-exported from `@thru/passkey-manager` for convenience:

**Crypto**: `parseDerSignature`, `normalizeLowS`, `normalizeSignatureComponent`, `P256_N`, `P256_HALF_N`, `bytesToBigIntBE`, `bigIntToBytesBE`

**Encoding**: `arrayBufferToBase64Url`, `base64UrlToArrayBuffer`, `bytesToBase64Url`, `base64UrlToBytes`, `bytesToHex`, `hexToBytes`, `bytesEqual`, `compareBytes`, `uniqueAccounts`

## Types

Key types exported from this package:

| Type | Description |
|------|-------------|
| `PasskeyRegistrationResult` | Credential ID and P-256 public key coordinates |
| `PasskeySigningResult` | Signature bytes, authenticator data, and client data |
| `PasskeyDiscoverableSigningResult` | Signing result with credential ID and rpId |
| `PasskeyStoredSigningResult` | Signing result with attached passkey metadata |
| `PasskeyMetadata` | Stored passkey info (credential ID, public key, rpId, timestamps) |
| `PasskeyClientCapabilities` | WebAuthn client capability flags |
| `PasskeyPopupContext` | App context passed to popup for display |
| `PasskeyPopupAccount` | Account info passed through popup bridge |
