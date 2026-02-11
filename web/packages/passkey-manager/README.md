# @thru/passkey-manager

Platform-agnostic TypeScript library for interacting with the on-chain `passkey_manager` program. It provides ABI-generated instruction builders, P-256 cryptographic utilities, and helpers for constructing passkey-authenticated transactions. Works in browsers, React Native, and Node.js.

## Installation

```bash
npm install @thru/passkey-manager
```

## Basic Usage

```ts
import {
  encodeCreateInstruction,
  encodeValidateInstruction,
  encodeTransferInstruction,
  concatenateInstructions,
  createWalletSeed,
  deriveWalletAddress,
  buildAccountContext,
  createValidateChallenge,
  parseDerSignature,
  normalizeLowS,
  PASSKEY_MANAGER_PROGRAM_ADDRESS,
} from '@thru/passkey-manager';

// Derive a wallet address from a passkey's public key
const seed = await createWalletSeed('my-wallet', pubkeyX, pubkeyY);
const walletAddress = await deriveWalletAddress(seed, PASSKEY_MANAGER_PROGRAM_ADDRESS);

// Build account context for the transaction
const ctx = buildAccountContext({
  walletAddress: 'taWalletAddress...',
  readWriteAccounts: [recipientBytes],
  readOnlyAccounts: [],
});

// Encode instructions using ABI-generated builders
const create = encodeCreateInstruction({
  walletAccountIdx: ctx.walletAccountIdx,
  authority: { tag: 1, pubkeyX, pubkeyY },
  seed,
  stateProof,
});

const transfer = encodeTransferInstruction({
  walletAccountIdx: ctx.walletAccountIdx,
  toAccountIdx: ctx.getAccountIndex(recipientBytes),
  amount: 1_000_000n,
});

// Combine multiple instructions into a single payload
const payload = concatenateInstructions([create, transfer]);

// Build the challenge that the passkey must sign
const challenge = await createValidateChallenge(nonce, ctx.accountAddresses, payload);
```

### Processing a Passkey Signature

```ts
import {
  parseDerSignature,
  normalizeLowS,
  encodeValidateInstruction,
} from '@thru/passkey-manager';

// Parse the DER-encoded signature from WebAuthn
const { r, s } = parseDerSignature(derSignatureBytes);
const normalizedS = normalizeLowS(s);

// Encode the validate instruction with the parsed signature
const validate = encodeValidateInstruction({
  walletAccountIdx: ctx.walletAccountIdx,
  authIdx: 0,
  signatureR: r,
  signatureS: normalizedS,
  authenticatorData,
  clientDataJSON,
});
```

## Instruction Builders

Each instruction maps to an on-chain `passkey_manager` program handler. All builders use ABI-generated types for type-safe serialization.

| Function | Description |
| --- | --- |
| `encodeCreateInstruction` | Create a new passkey-managed wallet account |
| `encodeValidateInstruction` | Submit a passkey signature for transaction authorization |
| `encodeTransferInstruction` | Transfer lamports from a managed wallet |
| `encodeInvokeInstruction` | Invoke a cross-program instruction from a managed wallet |
| `encodeAddAuthorityInstruction` | Add a passkey or pubkey authority to a wallet |
| `encodeRemoveAuthorityInstruction` | Remove an authority from a wallet |
| `concatenateInstructions` | Combine multiple encoded instructions into one payload |

## Cryptographic Utilities

Platform-agnostic P-256 / ECDSA helpers that do not depend on any native crypto library beyond `crypto.subtle`:

- `parseDerSignature` -- extract r and s components from a DER-encoded ECDSA signature
- `normalizeLowS` -- enforce low-S form (BIP-62 / SEC1 compliance)
- `normalizeSignatureComponent` -- pad or trim a signature component to exactly 32 bytes
- `bytesToBigIntBE` / `bigIntToBytesBE` -- big-endian bigint conversion
- `P256_N` / `P256_HALF_N` -- P-256 curve order constants

## Encoding Utilities

Zero-dependency byte manipulation functions:

- `arrayBufferToBase64Url` / `base64UrlToArrayBuffer` -- ArrayBuffer base64url conversion
- `bytesToBase64Url` / `base64UrlToBytes` -- Uint8Array base64url conversion
- `bytesToHex` / `hexToBytes` -- hex string conversion
- `bytesEqual` / `compareBytes` -- byte array comparison
- `uniqueAccounts` -- deduplicate account byte arrays

## Account and Seed Helpers

- `createWalletSeed(walletName, pubkeyX, pubkeyY)` -- derive a deterministic 32-byte seed from a wallet name and passkey public key coordinates via SHA-256
- `deriveWalletAddress(seed, programAddress)` -- derive the on-chain PDA for a managed wallet
- `buildAccountContext(params)` -- build a sorted, deduplicated account context with index lookup for transaction construction
- `parseWalletNonce(data)` / `fetchWalletNonce(sdk, address)` -- read the current nonce from on-chain wallet account data

## Types

```ts
import type {
  PasskeyMetadata,
  PasskeyRegistrationResult,
  PasskeySigningResult,
  PasskeyDiscoverableSigningResult,
  Authority,
  AccountContext,
  CreateInstructionParams,
  ValidateInstructionParams,
  TransferInstructionParams,
  WalletSigner,
  TransactionExecutionSummary,
} from '@thru/passkey-manager';
```

| Type | Description |
| --- | --- |
| `PasskeyMetadata` | Local metadata for a registered passkey (credential ID, public key, RP ID) |
| `PasskeyRegistrationResult` | Result of WebAuthn credential creation |
| `PasskeySigningResult` | Parsed WebAuthn assertion with raw r/s components |
| `PasskeyDiscoverableSigningResult` | Signing result that includes the discovered credential ID |
| `Authority` | Tagged union for passkey (P-256) or pubkey (Ed25519) authorities |
| `AccountContext` | Sorted account list with index lookup for transaction building |
