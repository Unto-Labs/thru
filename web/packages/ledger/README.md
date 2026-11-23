# @thru/ledger

Ledger hardware-wallet signer for Thru. It is built on the Ledger
[Device Management Kit](https://github.com/LedgerHQ/device-sdk-ts) (DMK) and
talks to the Thru device app. LedgerJS (`hw-app-*`, `hw-transport-*`) is
deprecated and is not used.

- **Protocol:** `specs/ledger/app-thru-apdu.md` (APDU spec, normative).
- **Plan:** `specs/ledger/ledger-integration-plan.md` (Phase 4, §4.1, §4.3).
- **Conformance corpus:** `contrib/test/vectors/signing/`.

> **Not published yet.** `package.json` sets `"private": true`, so the
> monorepo npm release (`.github/workflows/npm-publish.yml`, which skips
> private packages) does not publish this package before the Ledger audit
> gate (plan Phase 8). Workspace consumers (`workspace:*`) are unaffected.
> Remove `"private": true` when the package is cleared for release.

> The Thru device app is a side-loaded developer build in v1. Thru uses
> registered SLIP-44 coin type `8478`.

## What it does

| Operation | Device INS | What the user sees | Blind signing needed |
|---|---|---|---|
| `getAddress(path, { display })` | `GET_PUBKEY` | The `ta…` address and path (with `display: true`) | No |
| `getAppConfig()` | `GET_APP_CONFIG` | Nothing | No |
| `signTransactionBody(path, body, { tokenHint })` | `SIGN_TXN` (body streamed) | For a native, token or wallet transfer: action, source, recipient and amount (token transfers: the token accounts, or with a `tokenHint` the owners; the mint with a hint or for a `TransferChecked`, which also shows the amount in whole units with its ticker). Then network, fee payer, program, fee, nonce, validity window, account counts, instruction size and transaction hash | Only for transactions that are not such a transfer |
| `signMessage(path, bytes)` | `SIGN_MESSAGE` (two passes) | Labelled text lines (§8.7), or a SHA-256 fingerprint | Only for the fingerprint |
| `signEoaAuth(path, kind, chainId, feePayer, account)` | `SIGN_EOA_AUTH` | "Authorize account creation/deletion", network, account and fee payer | No |

Every operation:

- checks that the open app is "Thru" (`B0 01`) and that the app's APDU
  protocol version is supported;
- validates its inputs on the host first, so errors are early and clear. The
  host uses the same envelope rules as the device, including the fee-payer
  check;
- **verifies the device signature strictly before returning it**.
  Transactions go through `attachTransactionSignature`; messages and EOA
  authorizations go through the SDK's strict verifiers;
- throws typed errors (see [Errors](#errors));
- refuses to sign on networks configured for the `Legacy` signing scheme
  (plan decision D11), before contacting the device. `transactionSigningScheme`
  is a required option with no default (pass
  `thru.ctx.transactionSigningScheme`); a signer that was not told the scheme
  refuses to sign.

## Install

```bash
pnpm add @thru/ledger @thru/sdk @ledgerhq/device-management-kit rxjs@7.8.2
# Pick the transports you need:
pnpm add @ledgerhq/device-transport-kit-web-hid     # browsers (WebHID)
pnpm add @ledgerhq/device-transport-kit-speculos    # emulator (tests, CI)
pnpm add @ledgerhq/device-transport-kit-node-hid    # Node.js over USB (native modules)
```

| Entry | Contents |
|---|---|
| `@thru/ledger` | `ThruLedgerSigner`, SDK adapters, errors, the DMK signer kit, and everything in `/protocol` |
| `@thru/ledger/protocol` | The DMK-free protocol layer: encoders, path policy, status words, envelope parser and preview helpers |
| `@thru/ledger/webhid` | `createWebHidDmk()`, `connectWebHid(dmk)` |
| `@thru/ledger/speculos` | `createSpeculosDmk({ url })`, `connectSpeculos(dmk)` |
| `@thru/ledger/node-hid` | `createNodeHidDmk()`, `connectNodeHid(dmk)`. The kit is loaded dynamically, so install it yourself. |

> **Plain Node.js ESM:** DMK 1.11.0's own ESM build uses directory imports,
> which bundlers accept but Node's ESM loader rejects
> (`ERR_UNSUPPORTED_DIR_IMPORT`). In unbundled Node scripts, `require()` this
> package (the CJS build resolves DMK's CJS build), or use a bundler or
> `tsx`. `@thru/ledger/protocol` has no DMK dependency and loads anywhere.

## Quick start (browser)

WebHID needs a top-level browsing context and a user gesture. The Thru wallet
runs Ledger flows in a top-level popup on the wallet origin, because a
cross-origin iframe cannot use WebHID without `Permissions-Policy: hid`
delegation.

```ts
import { ThruLedgerSigner, ledgerPathForAccount } from '@thru/ledger';
import { createWebHidDmk, connectWebHid } from '@thru/ledger/webhid';
import { createThruClient } from '@thru/sdk/client';

const thru = createThruClient({ baseUrl: 'https://rpc.alphanet.thru.org' });
const dmk = createWebHidDmk();

connectButton.onclick = async () => {
  const sessionId = await connectWebHid(dmk);   // opens the device picker
  const ledger = new ThruLedgerSigner({
    dmk,
    sessionId,
    transactionSigningScheme: thru.ctx.transactionSigningScheme,
  });

  const path = ledgerPathForAccount(0);         // m/44'/8478'/0'/0'
  const { address, publicKey } = await ledger.getAddress(path, { display: true });
  console.log('Ledger account', address);
};
```

## Sending a transaction (SDK external-signer flow)

The device needs the transaction **body**, not the 48-byte `M`. It parses
the envelope, hashes the body itself and signs
`"tn_txn_sign_v1__" ‖ SHA-256(body)`. The SDK builds `M` only to cross-check
the returned signature.

The adapter snapshots the serialized body before awaiting `onReview`, so
the preview and the bytes sent for signing cannot diverge if the builder
reuses its buffer.

```ts
import { sendWithLedger } from '@thru/ledger';

const signature = await sendWithLedger(
  thru,
  ledger,
  path,
  publicKey,                                    // the Ledger account pays the fee
  { program: programAddress, accounts: { readWrite: [recipient] }, instructionData },
  {
    // Show this before the device prompt so the user can compare (spec §11.3).
    onReview: (review) => showPreview(review.fields, review.transactionHash),
    onProgress: (p) => setProgress(p.bytesSent / p.bytesTotal),
    onInteraction: (i) => i === 'sign-transaction' && showHint('Review on your Ledger'),
  },
);
```

**Resource budget (header).** The SDK defaults compute, state and memory
units to 0, so set them for your program in `build.header`. For EOA-program
calls the adapter defaults to `EOA_TRANSFER_RESOURCES` (10,000 compute,
10,000 memory, 0 state), matching the Rust `build_transfer` builder. Any
field you set in `build.header` (units, `fee`, `expiryAfter`, `nonce`, …)
wins. For other programs the adapter passes your header through unchanged.

```ts
await sendWithLedger(thru, ledger, path, publicKey, {
  program: programAddress,
  instructionData,
  header: { computeUnits: 300_000, memoryUnits: 10_000, stateUnits: 0, fee: 0n, expiryAfter: 200 },
});
```

The same flow, step by step:

```ts
import { computeBodyHashDisplay, describeTransaction } from '@thru/ledger';

const tx = await thru.transactions.build({
  feePayer: { publicKey },
  program: programAddress,
  accounts: { readWrite: [recipient] },
  instructionData,
});
const body = tx.toWireForSigning();

const review = describeTransaction(body, publicKey);  // the device's fields, same strings
review.requiresBlindSigning;                          // false for a transfer the device clear-signs
computeBodyHashDisplay(body);                         // the device's "Transaction hash"

const { signedTransaction } = await ledger.signTransactionBody(path, body);
await thru.transactions.send(signedTransaction);      // already verified and attached
```

## Token transfers: show the mint and the owners

A token `Transfer` names only two token accounts, so by default the device
shows those accounts and the amount in base units. A `TransferChecked`
(what `createTransferCheckedInstruction` builds) also names the mint and
carries the decimals and ticker, which the token program checks against the
mint: the device shows the mint, the amount in whole units (`0.25`, spec
B.7) and the ticker in its own `Ticker` field (§7.7; left out when the
ticker is empty), provided the mint is one of the first 4 read-only
accounts, the ticker 0 to 8 printable ASCII characters without space, and
the decimals at most 19. Otherwise it is a blind-signed transaction. `decodeClearTransfer(body).checked` gives the mint, decimals
and ticker the device will show.

Pass a `tokenHint` with the mint and the recipient's owner, and the device
shows the two wallet addresses instead of the token accounts, and the token
mint (spec §7.2.1):

```ts
const { signedTransaction } = await ledger.signTransactionBody(path, body, {
  tokenHint: {
    mint,                 // 32 bytes
    recipientOwner,       // 32 bytes: the wallet that owns the recipient token account
    // recipientSeed, sourceSeed: 32 bytes each, default 32 zero bytes
    // (the seed wallets use when they create token accounts)
  },
});
```

The hint is not signed and is not trusted. The source must be the fee
payer's token account and the recipient `recipientOwner`'s, both for `mint`:
`tokenAccountAddress(owner, mint, seed)` =
`SHA-256(TOKEN_PROGRAM ‖ 0x00 ‖ SHA-256(owner ‖ mint ‖ seed))`. The library
checks this with `verifyTokenHint(body, hint)` before contacting the device
and throws `InvalidRequestError` (`reason: 'token_hint'`) if it does not
hold; the device checks it again and answers `6814` otherwise. For a
`TransferChecked` the hint's mint must also be the mint the transaction
names. A hint never supplies decimals or a ticker: for a `Transfer` the
amount stays in base units.
`verifyTokenHint` returns the mint, owners and amount the device will show,
and `describeTransaction(body, publicKey, { tokenHint })` the whole review
for your preview. A token transfer needs no blind signing, with or without
a hint.

## Creating the Ledger account's EOA

A new Ledger key needs an on-chain EOA before it can pay fees. The Ledger
authorizes its own creation with the clear-signed `SIGN_EOA_AUTH`. A
different, existing key pays for and signs the creation transaction. That key
can be the user's current fee payer, a faucet key on test networks, or another
Ledger account.

```ts
import { createLedgerEoa, ledgerBodySigner, privateKeyBodySigner } from '@thru/ledger';

const result = await createLedgerEoa({
  thru,
  ledger,
  path,                                                         // the new Ledger account
  feePayer: privateKeyBodySigner(feePayerSecret, feePayerPubkey),
  // or: feePayer: ledgerBodySigner(ledger, otherPath, otherPubkey),
});
console.log('created', result.transactionSignature);
```

`createLedgerEoa` checks that the fee-payer signer returns the reviewed
transaction body unchanged and a valid fee-payer signature before sending.
An invalid signer response is rejected locally without submitting a transaction.

The creation transaction defaults to `EOA_CREATE_RESOURCES` (10,000
compute, 10,000 memory, 1 state unit), matching the Rust
`build_create_with_fee_payer_proof` builder and the web wallet. Pass
`header: { fee, expiryAfter, computeUnits, … }` to override individual
fields. Its `chainId` always equals the chain id the device authorized.

Under the hood: `signEoaAuth(path, 'create', chainId, feePayer, account)` →
CREATING state proof → `eoa.buildCreateEOAInstruction(2, auth, proof)` → build
on the EOA program → the fee payer signs → verify, attach and send. The proof
is fetched after the device step because the runtime accepts it for only 128
slots; the authorization does not cover it.

`options.signal` cancels the creation at any step before it is sent, and is
passed to the fee payer's `signTransactionBody(body, { signal })`, so a
`ledgerBodySigner` fee payer stops on the device too.

## Messages

```ts
const msg = new TextEncoder().encode('Sign in to example.org');
const { signature } = await ledger.signMessage(path, msg);   // M = "tn_msg_sign_v1__" ‖ msg
```

Pass `{ expectedPublicKey }` to bind the signature to a known account:
`await ledger.signMessage(path, msg, { expectedPublicKey })` throws
`KeyMismatchError` before the device prompt if the connected device holds a
different key.

- Messages are 1..32768 bytes.
- Text mode follows APDU spec §8.7: 1..512 ASCII/LF bytes, at most 16 lines,
  every space between two non-space printable bytes, and no 11-byte
  alternating run `N space N space N space N space N space N`.
  Each LF-separated line is labelled, including empty lines. Anything else
  shows a SHA-256 fingerprint (`computeMessageHashDisplay(msg)`) and needs
  blind signing.
- Use `messageDisplayMode(msg)` to tell the user in advance.
- The message is streamed twice. The user approves on the last chunk of the
  first pass, and the signature arrives at the end of the second pass.

## Derivation paths

The device accepts exactly `m/44'/8478'/{a}'/0'` (canonical) and
`m/44'/8478'/{a}'`, with every component hardened and `0 ≤ a ≤ 2^31 − 1`.
At depth 4, the change component must be `0'`.

```ts
import { isLedgerPath, parseLedgerPath, ledgerPathForAccount, encodeLedgerPath } from '@thru/ledger';

isLedgerPath("m/44'/8478'/0'/0'");      // true
isLedgerPath("m/44'/8478'/0'/1'");      // false: change must be 0'
isLedgerPath("m/44'/501'/0'/0'");       // false: wrong coin type
parseLedgerPath("m/44'/8478'/7'");      // { depth: 3, account: 7, components, path }
ledgerPathForAccount(7, 3).path;        // "m/44'/8478'/7'"
```

Only `'` marks hardening. Values must be canonical decimal. Anything the
device would reject throws `PathRejectedError` before the device is
contacted.

## Errors

Every failure is a `ThruLedgerError` with a stable `code`, an optional
`statusWord`, and a user-facing `hint`.

| Error | `code` | Status words | Typical fix (`hint`) |
|---|---|---|---|
| `UserRejectedError` | `UserRejected` | `6985` | Approve on the device |
| `BlindSigningDisabledError` | `BlindSigningDisabled` | `6808` | Enable "Blind signing" in the Thru app settings |
| `WrongAppError` (`reason`) | `WrongApp` | `6E01`, `6511`, `6D02`, `6E00`; the open app is not "Thru"; Thru app not installed | Open the Thru app |
| `LockedError` | `Locked` | `5515` | Unlock the device |
| `PathRejectedError` | `PathRejected` | `6820`; host-side path checks | Use `m/44'/8478'/a'/0'` |
| `FeePayerMismatchError` | `FeePayerMismatch` | `6810`; host-side check | Put the Ledger key in the fee-payer slot |
| `MalformedTransactionError` (`reason`) | `MalformedTransaction` | `6801`-`6807`, `6809`, `680A`, `6811`, `6812` | Rebuild the transaction |
| `EoaAccountMismatchError` | `EoaAccountMismatch` | `6850` | Authorize only the device's own account |
| `InvalidRequestError` (`reason`) | `InvalidRequest` | `6840`, `6851`, `6804` from `SIGN_EOA_AUTH`, `6814` (`token_hint`); host-side token hint check | Fix the request |
| `ProtocolError` (`reason`) | `Protocol` | `6700`, `6A86`, `6830`, `6831`, `6841`, `6E03`; malformed responses | Retry from the start (host/device bug) |
| `UnsupportedError` | `Unsupported` | `6D00`, `6813` (unknown token hint kind) | Update the Thru app |
| `UnsupportedAppVersionError` | `UnsupportedAppVersion` | `apdu_protocol_version` ≠ 1 | Update the app or this library |
| `UnsupportedSigningSchemeError` | `UnsupportedSigningScheme` | Network uses `Legacy` signing | Not supported with Ledger |
| `KeyMismatchError` | `KeyMismatch` | The device key ≠ the expected key | Select the matching account |
| `InvalidSignatureError` | `InvalidSignature` | The signature failed strict verification | Retry; never use the signature |
| `DeviceInternalError` | `DeviceInternal` | `6F00` | Retry or restart the app |
| `DeviceBusyError` | `DeviceBusy` | `6901` for longer than `busyRetry.budgetMs` (default 5 s); shorter bursts are retried automatically | Wait for the app's home screen |
| `TransportError` | `Transport` | Disconnects, timeouts and other DMK errors | Reconnect and retry from the start |
| `CancelledError` | `Cancelled` | `AbortSignal` / DMK cancel | — |
| `UnknownStatusWordError` | `UnknownStatusWord` | Anything else, including `6A80`-`6A8F` other than `6A86` | — |

`MalformedTransactionError.reason` is one of `invalid_format`,
`invalid_version`, `invalid_flags`, `chain_id_zero`,
`invalid_fee_payer_state_proof_type`, `account_count_limit_exceeded`,
`duplicate_account`, `unsorted_readwrite_accounts`,
`unsorted_readonly_accounts`, `pad_nonzero` or `rw_cache_exceeded`.

Mapping decisions beyond the letter of spec §5.3:

- `6E00` is treated as `WrongApp`, because this host only sends CLA `E0`.
- `6D00` is treated as `Unsupported`.
- `6700` and `6A86` are treated as `Protocol`.

```ts
import { ThruLedgerError } from '@thru/ledger';

try {
  await ledger.signTransactionBody(path, body);
} catch (e) {
  if (e instanceof ThruLedgerError) showError(e.message, e.hint);
  else throw e;
}
```

## Long streams, progress and cancellation

A full 32 KiB body is 130 APDUs (one path chunk plus 129 data chunks of 255
bytes).

- `onProgress` is called after every data chunk.
- `signal` (an `AbortSignal`) cancels the DMK device action.
- No short timeout is ever applied to an APDU that waits for the user.
- After any error or disconnect the operation restarts from chunk 0.

Each multi-APDU operation runs inside a single DMK device action. DMK's
intent queue therefore keeps the session pinger and refresher APDUs from
interleaving with the stream. An interleaved APDU would reset the device
session.

## Lower-level APIs

- **DMK signer kit (observable style):**
  `new SignerThruBuilder({ dmk, sessionId, transactionSigningScheme }).build()`.
  Each operation returns `{ observable, cancel }`. The device-action
  factories (`signTransactionDeviceAction`, …) and tasks are also exported;
  the signing tasks take `transactionSigningScheme` too. Every layer refuses
  a non-RFC-8032 scheme before any APDU (D11).
- **Commands:** `GetPubkeyCommand`, `SignChunkCommand`, `SignEoaAuthCommand`,
  … for `dmk.sendCommand`.
- **Pure protocol:** the `@thru/ledger/protocol` entry provides:
  - `signTxnApdus(path, body)` and `signMessageApdus(path, msg)` (chunk plans).
    The optional `chunkSize` must be 128..255 (default 255), and a stream
    that would need more than 255 data chunks is refused, because P1 is one
    byte and never wraps (spec §3.4);
  - `serializeApdu`;
  - `TxnStreamParser` (the device's envelope checks, with status words);
  - `describeTransaction`, `describeMessage` and `describeEoaAuth` (device
    screens);
  - `formatThruAmount`, `formatAmount`, `formatTokenAmount` and
    `networkLabel`.

Wallet transfers are recognized only at
`taPASSIvjIgz2kZ1CIIhvbT00XV9Ve5kZ2I9uDLanzIgbA`, matching the device app
and the SDK bootstrap addresses. Transfers to the retired Wallet program
require blind signing.

## Testing

```bash
pnpm --filter @thru/ledger test          # unit, corpus, mock-device and fake-Speculos suites
pnpm --filter @thru/ledger typecheck
pnpm --filter @thru/ledger lint

# Against the real app on Speculos (opt-in):
speculos --model nanosp --seed "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about" app-thru.elf
SPECULOS_URL=http://127.0.0.1:5000 pnpm --filter @thru/ledger test:speculos
```

| Suite | Covers |
|---|---|
| `protocol.test.ts` | Spec worked examples A.1-A.6, Appendix B formats, path policy and HD vectors |
| `transfer.test.ts` | Clear-transfer shapes, SDK Wallet program identity, and blind signing for the retired Wallet program |
| `device-review.test.ts` | Review parity with the device app's fixtures, synchronized with `rpc/thru-ledger/tests/fixtures/device-review-cases.json` |
| `txn-parser.test.ts` | Every envelope check and its status word; chunking invariance |
| `errors.test.ts` | Every status word mapped to its typed error |
| `corpus.test.ts` | `txn_vectors.json`, `message_vectors.json` and `eoa_auth_vectors.json`. The corpus files are required. |
| `mock-device.test.ts` | The full DMK stack against a simulated Thru app: exact APDU sequences, 129-chunk streaming, the two-pass message, every status word through DMK, host pre-checks, cancellation, corpus signatures, and the SDK adapter |
| `speculos-transport.test.ts` | The Speculos transport over HTTP against a fake Speculos server |
| `speculos.integration.test.ts` | The real app (`SPECULOS_URL`). `SPECULOS_AUTOMATION=nano` auto-approves on button devices. |
