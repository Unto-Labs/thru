# thru-ledger

Host-side Ledger support for Thru: the APDU protocol of the Thru device app,
USB HID and Speculos transports, and `LedgerSigner`, an implementation of
`thru_base::signer::Signer` whose key lives on a Ledger.

The protocol is normative in
[`specs/ledger/app-thru-apdu.md`](../../specs/ledger/app-thru-apdu.md); the
integration plan is [`specs/ledger/ledger-integration-plan.md`](../../specs/ledger/ledger-integration-plan.md)
(§4.1, §4.2, Phase 3).

## Usage

```rust
use thru_base::signer::{sign_transaction_body_with, sign_message_with};
use thru_ledger::{DerivationPath, HidTransport, LedgerSigner};

let path = DerivationPath::from_uri("ledger://44'/8478'/0'/0'")?;
let signer = LedgerSigner::connect(HidTransport::open()?, path)?;
println!("{}", signer.address());            // ta…

signer.verify_address_on_device()?;          // show address + path on the device

// Streams the full body (never M) and verifies the device signature strictly.
let signed_wire = sign_transaction_body_with(&signer, &body)?;
let msg_sig = sign_message_with(&signer, b"hello")?;
```

`LedgerSigner::connect_expecting(transport, path, &pubkey)` additionally fails
with `KeyMismatch` when the device key differs from a cached key (wrong
device, seed or passphrase). `with_progress(Some(Arc::new(|p: &Progress| …)))`
reports every chunk and flags the APDU that waits for the user
(`awaiting_user`), so callers can print "approve on your Ledger" and must not
time out.

Lower layers are public too:

| Module | Contents |
|---|---|
| `path` | `DerivationPath`: §4.2 policy (depth 3/4, all hardened, `44'/8478'`, change `0'`), `m/…` and `ledger://…` forms, APDU encoding |
| `apdu` | byte-exact builders for every INS (chunked SIGN_TXN, two-pass SIGN_MESSAGE, SIGN_EOA_AUTH, GET_*), response parsers |
| `error` | status-word constants, `LedgerError` (one variant per SW class, actionable messages), `TxnReject` |
| `device` | `ThruLedger<T: Transport>`: protocol client without signature verification |
| `signer` | `LedgerSigner`: host obligations of spec §11 |
| `transport` | `Transport` trait (`exchange(&[u8]) -> data ‖ SW`) |
| `hid` | `HidTransport` (feature `hid`) |
| `speculos` | `SpeculosTransport` (feature `speculos`) |
| `mock` | `MockTransport` (scripted) and `SoftDevice`, a software emulator of the device app (feature `mock`) |

`Command::encode()` returns an error if the data exceeds the 255-byte short
APDU limit; `ThruLedger::exchange` propagates that error before transport I/O.

Thru uses coin type `consts::THRU_COIN_TYPE` (`8478`); SLIP-44 registration is pending.
Paths using the former placeholder `9999` derive different addresses and are not accepted.

## Features

| Feature | Default | Needs |
|---|---|---|
| `hid` | yes | `hidapi` (`linux-native-basic-udev` backend, pure Rust). On Linux there is no libudev at build or run time; users need Ledger's udev rules (`20-hw1.rules`) so they can open `/dev/hidraw*`. macOS and Windows need nothing extra. |
| `speculos` | no | nothing (std TCP) |
| `mock` | no | `hmac`, `sha2` 0.10 (SLIP-10 in the emulator) |

Build without HID (for example for emulator-only test tooling):
`cargo build -p thru-ledger --no-default-features --features speculos`.

## Host-side guarantees

- The body is validated with `validate_wire_transaction` and its fee payer is
  compared with the device key before anything is streamed; invalid bodies
  never reach the device.
- Signatures are verified with the strict, canonical verifier before they are
  returned (`InvalidSignature` otherwise). `attach_signature` re-verifies.
- SIGN_MESSAGE streams both passes from one immutable buffer and refuses to
  send the final pass-2 chunk if the two passes hash differently.
- `supports_legacy_scheme()` is `false` (decision D11).
- Every status word maps to a typed error per the spec §5.3 table (shared with
  `@thru/ledger`): `0x6700`/`0x6A86`/`0x6830`/`0x6831`/`0x6841` →
  `ProtocolError`, `0x6D00` and `0x6813` (unknown token hint kind) →
  `Unsupported`, `0x6814` → `InvalidRequest(TokenHint)`, `0x6E00` and the OS codes
  `0x6E01`/`0x6511`/`0x6D02` → `WrongApp`, `0x5515` → `Locked`, `0x6F00` →
  `DeviceError`, `0x6840`/`0x6851` → `InvalidRequest`, `0x6804` →
  `InvalidTransaction(ChainIdZero)` for SIGN_TXN but
  `InvalidRequest(ChainIdZero)` for SIGN_EOA_AUTH. `TxnReject::class()` returns
  the corpus `sw_class` names. `0x6E03` (SDK `BadLen`) → `ProtocolError`.
- `TransactionPreview` mirrors the device's §7.7 review: for a canonical
  native, token (Transfer or TransferChecked) or wallet transfer
  (`decode_clear_transfer`, a port of the device's rule) it starts with the
  transfer fields, and
  `requires_blind_signing` says whether the device needs the blind-signing
  setting.
- Token hint (§7.2.1): `try_sign_transaction_body_with_token_hint` sends a
  `TokenHint` (mint, recipient owner, account seeds) after the SIGN_TXN path.
  `verify_token_hint` checks it against the body first, as the device does,
  and the preview then shows the account owners and the mint.
- `0x6901` (the Ledger SDK busy with the status page shown after a review,
  about 3 s) is retried per APDU with a short backoff (`BusyRetry`, default
  5 s budget; `ThruLedger::set_busy_retry`), then reported as `Busy`.
- Exclusive sessions (§11.0): signers created with `LedgerSigner::for_path`
  share one connection and an operation-wide device mutex; INS `0x01` is never
  sent.
- `UserRejected` becomes
  `SignError::Rejected`; everything else becomes `SignError::Backend` with the
  actionable message (unlock, open the Thru app, enable blind signing, …).

## Tests

```bash
cargo test -p thru-ledger                       # unit, mock flows, corpus
SPECULOS_APDU_PORT=9999 cargo test -p thru-ledger --test speculos -- --ignored
```

- `tests/corpus.rs` consumes `contrib/test/vectors/signing/*.json` (required):
  HD path policy and keys, every txn vector against the emulated device
  (status word or exact signature), `LedgerSigner` pre-validation, message and
  EOA vectors.
- `tests/flows.rs`: exact APDU sequences (Appendix A), every status-word
  mapping, two-pass message flow, session rules, settings, progress.
- `tests/clear_transfers.rs`: the preview against
  `tests/fixtures/device-review-cases.json` (shared with `@thru/ledger`,
  generated from the device app's Ragger builders), clear transfers with blind
  signing off, and the token hint on the host and the emulated device.
- `tests/speculos.rs` (`#[ignore]`): against Speculos running the Thru app.
  `SPECULOS_SEED_NAME` selects the `hd_vectors.json` mnemonic;
  `SPECULOS_AUTO_APPROVE=1` (with an approve-everything automation rule and the
  `abandon … about` seed) enables bit-for-bit signing checks against the corpus,
  and `speculos_token_transfer_with_hint`: token transfers built as `thru
  token transfer` builds them (TransferChecked and, with `--unchecked`, the
  plain Transfer), signed with and without the hint, and the app's
  own `0x6814`/`0x6813` refusals.  Run one test at a time
  (`--test-threads=1`): Speculos serves one APDU client, and a second
  connection blocks.  The approver must walk the transfer fields (Action,
  Source, Recipient, Amount, Token mint, …) to the approve page.

## Speculos framing

The raw APDU server (default port 9999) uses `u32 BE length ‖ APDU` requests
and `u32 BE data length ‖ data ‖ SW1 SW2` responses. Button presses and screen
taps go through the Speculos REST API (port 5000), which this crate does not
drive.
