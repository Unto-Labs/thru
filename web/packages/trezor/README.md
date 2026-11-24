# @thru/trezor

Trezor host for the Thru device app, in TypeScript for browsers and Node. The
plan is `specs/trezor/web-host-plan.md`; the Rust host it mirrors is
`rpc/thru-trezor`.

> **Not published yet.** `package.json` sets `"private": true`. Nothing here
> works with a retail Trezor: the Thru app is loaded by firmware built from
> our fork (see the plan, section 1).

## What exists so far

The connection driver (the gate on building the host on Trezor's own
JavaScript library, decision B1), every request of the Thru app, the path
policy, typed errors, the signer with the shape of `ThruLedgerSigner`, its
adapter into the SDK's signing flow, the preview of the device's review, the
WebUSB transport and the IndexedDB credential store for browsers, and the Node
USB entry for a real device from a script. Not here yet: the wallet, and a run
on a physical Safe 7 (the manual steps are below).

| Entry | Contents |
|---|---|
| `@thru/trezor/protocol` | No device, no link, no Node built-in: the protobuf encodings of the messages the host sends and parses (`src/messages.ts`, `src/messages-json.ts`), the path policy (`protocol/path.ts`), the preview of the device's review (`protocol/preview.ts`) and the typed errors with the CLI's codes (`errors.ts`). It imports `@thru/ledger/protocol` (the transaction parser, the token hint, the address encoding) and nothing else; about 57 KB unminified of its own code. This is what a wallet frame imports. |
| `@thru/trezor` | Everything in `protocol`, the signer (`ThruTrezorSigner`, `connectTrezor`), the adapter (`trezorBodySigner`, `buildAndSignWithTrezor`, `sendWithTrezor`, `createTrezorEoa`), the driver below, the THP packet and handshake code of `@trezor/protocol` bundled with browser shims for Node's `crypto` and `Buffer` (`src/thp/`). Imports `@thru/ledger/protocol`, `@thru/sdk` and `@thru/sdk/proto`; no Node built-in. |
| `@thru/trezor/emulator` | Node only: the emulator's UDP transport (`node:dgram`) and the credential file store. The only transport on which pairing may be skipped, and only when the caller asks. The file store is in no other entry (a build check and a test say so). The UDP transport keeps at most `UDP_QUEUE_LIMIT` (1,024) unread datagrams; past that it fails with `UdpQueueFullError` and keeps nothing more. A credential file that cannot be read names the file and the field, never the value (it holds private keys). |
| `@thru/trezor/webusb` | Browser: the WebUSB transport (`requestWebUsbTransport`, which shows the browser's device picker and must be called from a click; `reopenWebUsbTransport`, for a device the origin already has permission for; `WebUsbTransport.open(device)`; `pickDevice`; `isWebUsbSupported`; `UsbTransportError`) and the IndexedDB credential store (`IndexedDbCredentialStore`, `IndexedDbCredentialError`). About 19 KB unminified, no import, no driver, no Node built-in (a build check). Chromium browsers only. |
| `@thru/trezor/node-usb` | Node only: a real device through the optional native package `usb` (`openNodeUsbTransport`, `requestNodeUsbTransport`, `createNodeUsb`), which offers the WebUSB interface so that the WebUSB transport above is the one that runs; and `FileCredentialStore`. `usb` is an optional peer dependency, loaded by a dynamic import the first time a transport is opened; nothing else needs it. Not reachable from `.`, `./protocol` or `./webusb` (a build check). |

### The USB transports

`WebUsbTransport` (`src/transports/webusb.ts`) is the Rust host's USB transport
(`rpc/thru-trezor/src/usb.rs`, proven on a physical Safe 7) on the WebUSB API:
vendor `0x1209`, product `0x53C1` (firmware, not the bootloader), interface 0 of
class `0xFF`, interrupt endpoints 1 in and 1 out, 64-byte packets. It checks the
descriptors after claiming the interface, and leaves nothing open or claimed when
a step fails.

- **A read is not abandoned when its caller stops waiting.** One IN transfer is
  in flight at a time. `readPacket` called while that transfer is pending returns
  the same promise, so the packet that arrives later reaches the next read, once;
  a second transfer would take it from the first. (The link also keeps its own
  read across its timeouts; this is the guarantee on the transport's side, and
  `usb-checks.ts` proves it: "a read that times out is not abandoned".) A caller
  must keep the promise it got until it settles, as the link does: a promise
  dropped after it resolved is a packet the caller chose not to read.
- **Writes are serialized** and each is bounded (10 s); a short write, a stall, a
  timeout or an unplug ends the transport, and the writes queued behind it fail
  with the same error without reaching the device.
- **`close` rejects the pending read, releases interface 0 and closes the
  device**, bounded (2 s) so that a stuck driver cannot hang the caller.
- **Typed errors** (`UsbTransportError.kind`; the link carries the kind into
  `TrezorTransportError.kind`, and `trezorErrorCode` maps it to the CLI's codes):
  `no_device_chosen` (the picker was closed; CLI code `not_found`),
  `not_found` and `ambiguous` (as in the Rust host), `busy` (another program holds
  the device: the error names Trezor Suite and the Bridge), `access_denied`
  (Linux needs the Trezor udev rules, Windows the WinUSB driver; also the browser
  refusing the picker outside a click), `disconnected` (unplugged, on a read, a
  write or the browser's `disconnect` event), `unsupported` (no WebUSB, or the
  `usb` package missing) and `io`.

`IndexedDbCredentialStore` keeps one record per device, keyed by the device's
public key, in one database (`thru-trezor`). A record is replaced by one `put` in
one transaction, so a reader sees the old record or the new one; `forget` deletes
one or all. It never logs a record, an error never carries a byte of one, and
where IndexedDB is unavailable every call fails with an error that says so: there
is no fallback to `localStorage` or to memory. A record that is not a credential
is an error that names the database and is left alone. The records hold host
private keys and belong to the origin: any script of the origin can read them
(plan J5).

### The signer

`ThruTrezorSigner` has the methods and result types of `ThruLedgerSigner`:
`getAddress(path, { display })`, `signTransactionBody(path, body, { tokenHint })`,
`signMessage(path, message)`, `signEoaAuth(path, kind, chainId, feePayer, account)`.
What differs, and why:

- Connect options are the Trezor's: transport, credential store, app image,
  host and app names, `passphraseOnDevice`, and the prompt callbacks of
  `TrezorUi` (type the pairing code, confirm on the device, enter the
  passphrase on the device). The Ledger's `onInteraction` per call has no
  counterpart: the callbacks are given once, at connect.
- Every signing call needs `transactionSigningScheme: 'rfc8032'` and refuses
  anything else before the device is used (`unsupported_signing_scheme`).
- The device key is read silently first and compared with the one expected (the
  transaction's fee payer, the authorization's account, or `expectedPublicKey`);
  every signature is verified in its domain before it is returned.
- Messages are text only (`TREZOR_TEXT_RULE`, 1 to 512 bytes): anything else is
  refused on the host with `invalid_request` (the Ledger signs the rest blind).
- A token hint is the Ledger's `TokenHint` or its 129 bytes.
- `sendWithTrezor` checks the call's original `options.signal` again immediately
  before submission, including after the device has returned a signature.
- `createTrezorEoa` needs a fee payer that can sign EOA-program creation, such as
  a local key. Another Trezor account cannot pay: the device refuses that outer
  transaction.
- An abort or a timeout after a request was sent ends the connection, and the
  error says `outcomeUnknown`: the device may have signed, and the host holds no
  signature. An abort also stops the packets of a message that is being written
  (it is looked at before every packet and while one is pending): nothing is
  written after it, and the connection is closed, which ends the transfer in
  flight. A request cut off after its first packet may still have reached the
  device, so it says `outcomeUnknown` too.
- What `outcomeUnknown` means, exactly. It describes one device request. For a
  request that asks the device to sign (a transaction with its pieces, a
  message, an EOA authorization), `outcomeUnknown: false` means one of two
  things: nothing of the request was handed to the transport (a body too large
  for a frame, an abort before the call, a closed connection), or the device
  answered with a refusal, which is Core's `Failure` (also how the app's
  refusals, `app_refused`, and the person's refusal on the device, `cancelled`,
  arrive), a locked device, or a device that stayed busy for the first message
  of the request. In both cases the device released no signature. It does not
  say that the device computed none: the app signs before its closing screen,
  and an interruption at that screen ends as a `Failure`; the signature then
  never leaves the device, and the outcome for the caller is known (no
  signature exists outside the device). `outcomeUnknown: true` means that
  something of the request was handed to the transport and the call ended
  without a refusal and without a usable answer (a transport failure, a
  timeout, an abort, an answer of another message type, a payload or an app
  response that does not decode, a signature of the wrong length, a signature
  or a key that does not check out after the device answered, a device that
  refused a later message of the exchange as busy after it took the request):
  the person may have approved and the device may have signed, and the host
  holds no signature. An abort between two pieces of a transaction body, which
  the host raises itself, is a known outcome: the device never got the whole
  body. For a request that does not sign (a public key, loading the app, the
  session) the flag is set when the error was raised after the first packet was
  handed to the transport and is a transport failure, a timeout (other than a
  device that stayed busy for the first message), an abort, a closed
  connection, a protocol error, or an unexpected answer that the connection
  itself rejects (a message for another session, more confirmations than the
  limit). It is not set for a refusal, nor for an answer that was received and
  could not be used: another message type, a payload or an app response that
  does not decode, a `Failure` that does not decode, a key that fails its
  checks. A compound operation of the
  adapter (`createTrezorEoa`, `sendWithTrezor`, `buildAndSignWithTrezor`) passes
  on the flag of its device step. Once the device step has succeeded the host
  holds the signature, and a failure of a later step (the proof, the build, the
  fee payer, the submission) is that step's error, with no flag: nothing about
  the device is unknown then. `client.channel` and the link's own `send` and
  `receive` are the raw channel: they do not classify requests or answers and
  set no flag, with one exception: a `send` whose acknowledgement never came
  throws a timeout of kind `ack` with `outcomeUnknown: true`.
- When the connection is closed. After a transport failure, a timeout or an
  abort after something was sent, and an answer that could not be read as the
  answer to the request (another message type, a payload that does not decode,
  an app answer of the wrong type or a public key or signature of the wrong
  length, a chunk request the image cannot serve while the app is loaded; this
  holds for `loadApp` and `ThruApp.load` called directly too). A refusal
  (`Failure`) leaves it open. A signature that does not verify against the
  device's key is marked and leaves it open: the answer was whole, and the
  stream is in step.
- Inputs are copied when the call is made, whatever holds them. A Node `Buffer`
  (and the `Buffer` this package exports) has a `slice` that is a view sharing
  memory with the original, so a caller who changes a `Buffer` while a request
  waits for the device must not change what is sent, shown or verified:
  paths, bodies, messages, keys, hints, builder options, credential records and
  the app image are all copied at the call (`copyBytes`, `snapshot.ts`), and the
  review, the request, the check of the key and the verification use the copies.
- One request of the app at a time, whole: a transaction is `SignTx` and then
  one `TxDataAck` for every piece the device asks for, and the loading of the app
  is several messages. Each is one operation on the connection
  (`operations.ts`); an operation started meanwhile (another transaction, a
  public key, the load) waits until it is over, as the Rust signer's lock does
  across a whole exchange. One that is aborted while it waits is never sent.
  Requests made through `TrezorClient.call` directly are serialized per message,
  not per operation; one of them that waits behind another ends when its own
  signal fires, without waiting for the one before it.
- A key mismatch (`key_mismatch`) says "this key belongs to a passphrase wallet,
  so another passphrase may have been typed on the Trezor" when the session was
  opened with `passphraseOnDevice` (the sentence of the CLI); for a standard
  session the text is unchanged. A signer built by hand takes
  `passphraseOnDevice` in its config and reports it as `signer.passphraseOnDevice`.
- `connectTrezor({ ..., onAppLoading })` calls `onAppLoading()` once, when the
  connection is paired and the session is open, before the app image is offered
  to the device: loading the app can take several seconds, and an application
  can say so. A callback that throws is caught and ignored (the status line must
  not break the connection it reports on); a promise it returns is not awaited,
  and its rejection is handled. The notification callbacks of `TrezorUi`
  (`confirmOnDevice`, `enterPassphraseOnDevice`) are guarded the same way: a
  throw, or a rejected promise or thenable they return, is swallowed and never
  ends the exchange (the device may be waiting for the answer to that very
  screen). `pairingCode` is the one callback whose result the client needs: a
  failure of it ends the pairing, which never runs inside a signing exchange.
- The app image is checked against the device before anything is sent, as the
  Rust host does: its header names the model it was built for (bytes 104 to 108,
  `T3W1` for the Safe 7, `T3T1` for the Safe 5), and an image for another model
  than the device reports is refused with `TrezorAppImageError` naming both
  models. The device does not check this itself. An image the device already
  holds is not looked at (the rule about fingerprints in `loadApp`). `loadApp`
  has no option to skip the check, and no entry of the package exports a load
  that skips it (a test checks the built entries).
- A credential store the application wrote is not trusted with what it says: when
  it fails, the connection error names the operation (reading or storing) and,
  only if it is on a fixed list (`Error`, `TypeError`, `RangeError`,
  `SyntaxError`, `ReferenceError`, `EvalError`, `URIError`, `AggregateError`,
  `DOMException`, `SecurityError`), the class name of what it threw, never its
  message or cause, because such a message may quote a record; any other name
  is left out, because an identifier can be a credential. This holds for every error the store throws, also one of
  this package's own error classes (`TrezorCredentialsError` and the rest): only
  an error that carries the package's own store mark passes with its text. The
  package's own stores (the file and IndexedDB) and its size check of a record
  carry the mark; they say what is wrong with their data (a path, a database
  name, a size) without quoting it and keep no cause that could quote file
  content.
- The adapter refuses, before the device is used, a transaction its own
  preview says the app will refuse (`invalid_request`, reason
  `unsupported_transaction`); the Ledger's adapter has no such check because its
  app signs anything blind.

### The preview

`transactionReview`, `messageReview` and `eoaAuthReview` return what the app
will show, step by step, in the JSON shape of the CLI's `trezor_preview`
(`rpc/cli/crates/thru-core/src/trezor_preview.rs`), or `null` when the app will
refuse. The transaction is parsed by `@thru/ledger/protocol`; the shape rules
on top are the Trezor app's. It is tied to the app by two tests that read the
app's own files: every case of `trezor/app-thru/tests/fixtures/sign_tx.json`
must give the review the fixture says (or none for a refused case), and
`TEXTS` must equal `trezor/app-thru/translations/en.json` in both directions.

### The driver

| Layer | File | Owns |
|---|---|---|
| Transport contract | `transport.ts` | 64-byte packets, one read outstanding at a time and kept across a timeout, `close` cancels it (B11). |
| Link | `thp/link.ts`, `thp/framing.ts` | Channel allocation (nonce matched), the handshake through the library's functions, splitting into packets and bounded reassembly (8,192 bytes declared), acknowledgements, retransmission of the same ciphertext (200 ms rising to 3.5 s, 8 s budget, 50 at most), the busy answer (100 ms doubling to 2 s, 30 s budget), duplicates, other channels' packets, the session byte of a message, the message counter (stops before 2^31), the exact lengths of the handshake's two answers (96 bytes and 17 before their checksums, as the Rust host's channel requires; the library ignores trailing bytes), and an abort looked at before every packet written and while one is pending. Time comes from an injected `Clock`. |
| Pairing | `pairing.ts`, `client.ts` | CPace with its guards (low-order key, input length, exactly six digits), the code check, the credential request (1 to 126 bytes), "paired" believed only when a stored credential matched. |
| Credentials | `credentials.ts`, `credentials-file.ts` | `CredentialStore` (`load`, `store`, `forget`), in memory and in a file (the Rust host's format, mode 0600, written atomically). |
| Client | `client.ts` | Sessions (standard wallet, or passphrase on the device), calls serialized (the request is encoded and copied at the call, before it waits its turn), button requests bounded at 64 with prompt callbacks, `Failure` mapped to typed errors (`errors.ts`), `AbortSignal` on every call. A request is never repeated automatically: an error raised after it was written says `outcomeUnknown`. |
| App loader and requests | `extapp.ts`, `app.ts` | The image from the bytes of its three files, the fingerprint in the load request (B13), the version rule, and every request of the app: `GetPublicKey`, `SignTx` (hint absent or exactly 129 bytes, the body sent in order and in full, copied first), `SignMessage`, `SignEoaAuth`; what the host can know (path policy, hint length, message length and text rule, chain id, key lengths) is refused before anything is sent. |

An error after the channel is open ends the connection when the state after it
cannot be told from the device's (a lost answer, an abort, an answer that could
not be read as the answer to the request); see "When the connection is closed"
above for what leaves it open.

### The shims (decision B3)

`@trezor/protocol` imports Node's `crypto` (`createHash`, `createHmac`,
`createCipheriv`, `createDecipheriv`, `randomBytes`) and reads a free global
`Buffer`. The build (`tsup.config.ts`) bundles the library and redirects both
to `src/thp/node-shims.ts`, which implements only those five functions, with
the algorithms the library uses, on `@noble/hashes` and `@noble/ciphers`, and
takes `Buffer` from the `buffer` package. The output has no import, no
`require` and no Node-only global, so any bundler can take it as it is.
`scripts/check-bundle.mjs` runs at the end of `pnpm build` and fails if that
stops being true.

`setRandomBytesSource` replaces the shim's `randomBytes` with a scripted one.
**It exists only for tests.** The vector tests run against the built browser
bundle and need to feed the vectors' private keys into the library functions
that make their own randomness; the function is exported from the main entry
for that, and an application never calls it. A call without `{ forTests: true }`
as its second argument throws and changes nothing, so the default source
(`crypto.getRandomValues`) cannot be replaced by accident. (Code of the same
page could replace `crypto.getRandomValues` itself, so this is a guard against
a mistake, not a defence.)

Every package compiled into the bundle is a development dependency and is
listed, with its licence, in `THIRD_PARTY_NOTICES.md`. The two packages the
bundle imports, `@thru/ledger` (its `./protocol` layer: the transaction parser,
the token hint, the address encoding) and `@thru/sdk` (signature verification
and the transaction flow), are runtime dependencies of the workspace and are
left to the application's bundler; `scripts/check-bundle.mjs` allows no other
import.

## Tests

`pnpm --filter @thru/trezor build` builds `dist/` and checks it.

```
pnpm --filter @thru/trezor test                    # builds, then vitest, in Node
pnpm --filter @thru/trezor test:browser            # builds, then the same checks in headless Chromium
pnpm --filter @thru/trezor test:emulator           # builds, then the Safe 7 emulator, from Node (below)
pnpm --filter @thru/trezor test:emulator:browser   # builds, then the same scenarios in headless Chrome, through WebUSB and IndexedDB
```

The signer checks (`src/__tests__/signer-checks.ts`, with the fake app of
`signer-support.ts`) cover the path policy against the shared derivation
vectors and the app's own accepted and refused paths, the errors and the CLI's
codes, the preview (the two parity tests above, the JSON shape, messages
against the shared message vectors, authorizations against the shared
authorization vectors), every request of the app, and the signer above a fake
that implements the app's protocol with a real Ed25519 key: each request signs
and verifies with the corpus signature; a wrong key, a signature that does not
verify (a changed bit, another domain, the wrong length), a wrong scheme, a
513-byte or non-text message, a zero chain id, another account and a 128-byte
hint are each refused with the right code, and the ones the host can know are
refused before any request; inputs changed after the call started change
nothing; abort. `bundle-check.test.ts` runs the build check on changed copies of
`dist/`. They run in Node and in Chromium like the driver checks.

The driver checks (`src/__tests__/driver-checks.ts`, `unit-checks.ts`) run the
driver on a scripted transport and virtual time: the two recorded
conversations of the vector file played through it with every host packet
compared with the file's, then the faults (a lost acknowledgement, a busy
answer, duplicates, other channels, a declared length over the bound, 65
button requests, an abort), the four guards, and the parts (framing, the
retransmission schedule, errors, the app image, the load exchange, the body
stream). They run in Node (`test`) and in Chromium (`test:browser`), both
against the built bundle. `src/__tests__/node.test.ts` is Node only: the
credential file, the UDP transport, and the recorded conversation over real UDP
sockets.

`test:browser` bundles `dist/index.js` with its dependencies (esbuild, in memory)
before serving it, as an application's bundler would.

`test:emulator` runs `trezor/scripts/test-web-host.sh`: it starts the headless
emulator, loads the wallet of the signing fixtures, answers and **reads** the
device's screens through the debug link, and runs `scripts/emulator-test.mjs`
against the built `dist/index.js` and `dist/emulator.js`. A run takes about five
minutes (the 32 signed cases are two of them: each review is read
step by step, every menu entry opened). What it covers:

| Group | What is checked |
|---|---|
| Gate | handshake, pairing by the code the device shows (a wrong code first), the credential file, a second connection without a code, the app loaded once, the key of account 0 against the shared vectors, the fixture's signature verified, pairing skipped only when asked |
| Signed fixture cases (32) | each case, with its token hint where it has one (7), through the signer: the fixture's signature, the hash the device shows, and **the review the device showed equal to the review of `transactionReview`** for that case (title, items and menu entries of every step, compared by `thru_review.py` of the Rust host's script) |
| Refused fixture cases (45) | each through the app: the app's reason as the typed error (`app_refused` for 42; the three hints of the wrong length are refused by the host before anything is sent, `invalid_request` with the same reason), and no request that shows a screen |
| Refusals on the device (8) | a transaction refused at its first step by the button and through the menu, at a later step by the button (`High fee`) and through the menu (`Summary`, the last step: `High fee` has no menu), a wallet transfer at `High fee`, a message, an EOA create by the button and an EOA delete through the menu: `cancelled` (CLI code `user_rejected`), the connection still works, the steps shown up to the refusal equal the first steps of the preview |
| An approval held back | 8 s before the final hold; the host waits and signs; the review equals the preview. A second time until a file exists (6 s), with the plan file written by hand in the helper's format, as the chain scenarios do (the expiry scenario holds the approval until the chain's slot has passed) |
| Messages | the six text vectors: signature and review (`messageReview`); the twelve that are not text are refused by the host with no screen |
| EOA authorizations | the eight valid vectors: signature and review (`eoaAuthReview`); the four refused ones are refused with no screen (the account mismatches by the app on the device, with its reason; the zero chain id by the host) |
| Passphrase key | `TREZOR` typed on the device through the helper gives the shared vectors' passphrase address; the same typed again gives it again (address shown); `OTHER` and an empty passphrase give `key_mismatch`; a standard key on a new connection right after is the standard wallet and shows no passphrase screen (5 checks) |
| The image | an image whose header was changed (the fingerprint differs): the device asks for it, fails to verify it, and the host's own image is uploaded again once; images of the versions 0.0.9, 0.1.0.5, 0.2.0 and 1.0.0 are refused by `parseAppImage`, naming the supported range, and the device gets no load request meanwhile |
| The older build (`TREZOR_OLDER_APP_IMAGE_DIR`) | the older build is uploaded and refuses a wallet transfer (`unsupported_transaction`, so it is the one running); connected again it is not uploaded again; the current build replaces it and signs the wallet transfer; the older one is then refused by the device (`Failed to load app`) and the error says what to do (`failureHint`: the device gives that one text for every refusal of the root packet or the image, so the hint names the rollback rule as one cause and says to check that the image, its proof and the root packet are from the same build); the current build loads again. Without the variable the scenario is skipped by name, with a printed line |
| Two connections | a second connection while the first waits at the device's code screen meets `TRANSPORT_BUSY` and an abort at the code prompt |

The shared helper is `trezor/scripts/web_host_screens.py`: it is the Rust host's
`host_screens.py` under one entry point (it calls it, it copies nothing), so the
screens are read, planned, answered and compared by the same code as the Rust
host's run. `scripts/lib/screens.mjs` is the test's side of it: `plan` (what to do
with the next request: approve, refuse at a step by the button or through the
menu, hold the final hold back, type a passphrase), `wait` and `compare` (the
helper's own comparison of a capture with the preview this package wrote as
JSON in the CLI's `trezor_preview` shape), and counters over the emulator's log
and the helper's report. What the helper cannot see is stated in `thru_review.py`:
whether a sentence is a note or a warning (decided by the two texts the app draws
as warnings) and whether a row break of a value stands for a space (a value with a
break is a set of readings, and the preview's text is accepted when it is one).

```
trezor/scripts/test-web-host.sh              # the Node run
trezor/scripts/test-web-host.sh --browser    # the browser run (below)
pnpm --filter @thru/trezor test:emulator     # builds, then the Node run
```

| Variable | Meaning |
|---|---|
| `TREZOR_WEB_HOST_PORT` | UDP port of the emulator the script starts (default 21324; its debug link is the next port) |
| `TREZOR_WEB_HOST_IMAGES` | the directory that holds the app image (default `trezor/app-thru/target/artifacts/serialized`) |
| `TREZOR_OLDER_APP_IMAGE_DIR` | optional, Node run only: the same for an older build of the same app version; without it the older-build scenario is skipped with a printed line |
| `TREZOR_LOG_DIR` | when set, the logs go to `$TREZOR_LOG_DIR/test-web-host` (emulator log, the helper's report, the captures, the previews the test wrote). Credential files and plans (which carry passphrases) never go there |

The Node run needs the firmware emulator and the app image for it, as the Rust
host's script does; it builds neither. It uses `dist/`, so run `pnpm build` first
(`test:emulator` does).

**Chain scenarios.** `web/packages-private/e2e-tests/src/scenarios/trezor/` is the
counterpart of the Ledger's TypeScript chain suite: for each shape the app signs,
the SDK adapter builds, the emulator signs with the helper approving, and the
transaction is submitted to a chain. `trezor_native_transfer`,
`trezor_token_transfer` (a plain transfer, the same with the token hint, a checked
transfer with the hint), `trezor_wallet_transfer` (the wallet program's `Validate`
around its `Transfer`, the Trezor key an authority of a passkey wallet),
`trezor_account_creation` (a fresh key creates itself with a creation proof),
`trezor_eoa_authorization`, `trezor_user_reject` (by the button and through the
menu: a cancellation, nothing submitted, nonce unchanged) and `trezor_expiry`
(the helper holds the final hold until the chain's finalized slot has passed the
window; the node rejects the transaction). Balances, the nonce and the hash the
device showed (read from the helper's capture) are checked against the preview.
They never run by default; select them with `e2e trezor` or by name, and they fail,
not skip, when the emulator, the image or the helper's directories are missing
(`harness.ts` lists the variables). **They have not been run:** they need a node
and the chain job's emulator (`ci-plan.md`, C10 and C11); they typecheck, lint
(with this package's ESLint configuration) and have unit tests for the harness.

`test:emulator:browser` (`trezor/scripts/test-web-host.sh --browser`) starts the
same emulator and screen helper and runs `scripts/browser-emulator-test.mjs`: the
built bundles `dist/index.js` and `dist/webusb.js` in headless Chrome, with the
production WebUSB transport and IndexedDB store, above a stand-in for
`navigator.usb`. **How packets travel:** the stand-in's device implements
`open`, `claimInterface`, `transferIn` and `transferOut` and nothing else; each
`transferOut` sends its 64 bytes, as hex, through a Playwright binding to the
script, which sends them as one UDP datagram to the emulator's port; each
`transferIn` asks the script, through another binding, for the next datagram.
The stand-in keeps what Chrome keeps: `requestDevice` is refused outside a
trusted click (and a click allows one request), a device can be claimed once, a
transfer pending when the device closes is aborted (and a datagram that was on
its way is handed back), the permission is remembered for the origin, and two IN
transfers at once are an error. The scenarios are those of `emulator-test.mjs`,
in six page loads, **each in its own browser launch with the IndexedDB and
localStorage of the one before** (Playwright's storage state):

| Page load | Covers |
|---|---|
| `pair` | IndexedDB empty; a request before any click refused; the picker from a click; a wrong pairing code refused and nothing stored; the right code pairs; the credential lands in IndexedDB (sizes checked); the app is uploaded; the key and address of account 0; the native transfer `transfer_shared_corpus` with the fixture's signature |
| `reconnect` | a new browser: the device is reopened with no click; the credential comes from IndexedDB, no code is asked, the app is not uploaded again; the same transfer signature; `connectTrezor` in one call: the address (shown on the device), a wrong expected key refused, a call after `close` refused |
| `messages` | two text messages with the corpus signatures; a non-text message refused by the host |
| `eoa` | EOA create and delete authorizations with the corpus signatures; one for another account refused |
| `tokens` | two hinted token transfers with the fixture's signatures and hashes; the preview says token transfer |
| `forget` | `forget` empties IndexedDB; the next connection asks for a code |

It checks at the end that every opened device was closed. A run takes about a
minute. Why each page load has its own launch: on a machine whose Chrome is
enrolled in cloud management, Chrome here exits by itself some 30 s after it
starts, even a bare `Google Chrome --headless=new`, and a second start on a
profile directory that has run for a few seconds waits for its first window until
that happens; so no browser lives long, and none reuses a profile directory.

The vector checks (`src/__tests__/vector-checks.ts`) run in both places too,
against
`contrib/test/vectors/trezor/host_vectors.json`, which the Rust host's own
code wrote (see the README next to it). Both use the built `dist/index.js`,
not the sources: in Node it is loaded with `import()`; in Chromium it is
served to a bare page that has no `Buffer`, `process` or `require`.
The USB checks (`src/__tests__/usb-checks.ts`, over the fakes of `usb-support.ts`)
run in Node twice, through `./webusb` and through `./node-usb` over a fake of the
`usb` module, and in Chromium through `./webusb`: opening (descriptors, what is
left claimed when a step fails, the typed causes), the read that times out and
is satisfied later (its packet reaches the next read, never lost or duplicated,
one transfer), packets in order whether or not a read was waiting, two requests
at once serialized, a write that fails ends the transport, short, oversized and
stalled transfers, a write that never completes, close during a read and during
a write, a close that is bounded, unplug during a read, during a write and by the
browser's event, the device filter, no device chosen, not from a click, no
WebUSB, none, a bootloader only, or several devices, and reopening. The IndexedDB
checks (`idb-checks.ts`) run in Chromium on its real IndexedDB (store, replace,
keep the others, forget one and all, copies, a second object sees the first's
records, thirty concurrent writes with thirty readers seeing one whole record, a
malformed record, wrong sizes with no key bytes in the error) and, in Node where
there is none, the unavailable case (a clear error, no fallback). The Node entry
has its own tests in `usb.test.ts` (module shapes, every device allowed, the
install hint, the Rust host's errors, the kind reaching `TrezorTransportError`
through the link). The real `usb` package is imported nowhere in the tests.

Three kinds of check were added after an independent review. Bytes held in a
`Buffer`, whose `slice` is a view, are passed to every signing method, to the
stores, to the queued calls, to the image loader and to the USB write, and
changed while the call is pending: what is sent and verified must be the
original (the checks use the bundle's own `Buffer`, `SharedSlice` in
`driver-support.ts` where there is none, and Node's `Buffer` in `node.test.ts`).
A credential file or an IndexedDB record that is corrupted must give errors
whose text, stack, `cause` chain and logged output contain no part of the key.
And the driver's guards each have a test that fails without them: an abort while
a packet is pending (`ScriptedTransport.holdWrite`), the exact lengths of the
handshake answers, the model of the image, whole operations in order (a scripted
app that refuses a request that interrupts a transaction), the callback of
`connectTrezor`, the UDP queue bound and `setRandomBytesSource` without its
argument. The reviews of the fixture are compared as ordered lists of label and
value, so a changed order or a repeated label is seen.

`test:browser` needs Google Chrome or Chromium; it uses Playwright's own if
installed, else the installed Chrome (channel `chrome`), else the executable in
`CHROME_PATH`. It downloads nothing. `THRU_TREZOR_BUNDLE=/path/to/module.js`
runs the checks against the package as another bundler wrote it.

The checks cover the message encodings (both directions), CPace and
Elligator2, AES-GCM with the THP nonces, credential lookup, packets and
checksums, the handshake of both scenarios with the vectors' fixed keys, and a
replay of both whole conversations through the library's `ThpState`. Where the
library differs from the Rust host, the check pins what the library does
(`deviation` in `vector-checks.ts`) and the test lists the ids. A changed
vector must be noticed: `vectors.test.ts` mutates the file and requires a
failure in the group that reads the value.

## What the library does not do

Found while building and testing the driver, and handled in it (the first four
are the first part's findings, pinned in `vector-checks.ts`):

- CPace: a low-order device key is hashed, not refused; a code or hash over 127
  bytes and a code that is not six digits give a wrong key silently.
- A credential over 126 bytes is used when it is the first match; the Rust host
  never uses it. The driver runs the handshake again with no credential.
- `getIvFromNonce` is wrong from a counter of 2^31; the link stops before.
- The decoder of encrypted messages drops the session byte
  (`decipherMessage` returns the plaintext without its first byte), so the
  rule "a wrong-session answer is refused" cannot be applied to it. The link
  decrypts with the library's AES-GCM and reads the byte itself.
- No packets (a frame is encoded whole), no reassembly, no timers, no
  retransmission schedule, no busy handling, no duplicate or channel filter.
- `encode` of an acknowledgement uses a different bit before and after
  piggybacking is enabled; the link gives the library the bit it means.

## Licence boundary

`@trezor/protocol` is MIT and is bundled. Packages of Trezor Suite under the
Trezor Reference Source License (`@trezor/connect`, `@trezor/connect-core` and
others) must not be used, copied or adapted: not as a dependency and not as
code, and their sources must not be consulted. The connection driver, pairing,
credentials, sessions and app loader are ours, ported from `rpc/thru-trezor`.

## Trying a real device (manual)

Needs a Trezor Safe 7 running firmware built from our fork (retail firmware
cannot load apps), unlocked and connected over USB; Trezor Suite and the Trezor
Bridge closed (a program that holds the device makes the connection fail with
kind `busy`); the Thru app image for the device's model and language: three
files, `<name>.tapp`, `<name>.proof` and the root packet (`root-packets/` next to
`serialized/`, named for the app's ring). On Linux the Trezor udev rules must give
the user access to `1209:53c1`; on Windows the interface must use the WinUSB
driver. Nothing below talks to a node or spends anything.

**The page** (Chrome or Edge, on `localhost`):

1. `pnpm install` in `web/`, then `pnpm --filter @thru/trezor build`.
2. `pnpm --filter test-dapp dev` and open `http://localhost:3001/trezor-test`.
3. Under "The app image" choose the three files. The page says the image's id,
   version and chunk count.
4. "Connect (browser picker)": the browser lists devices; choose the Trezor. The
   device asks to allow the connection: confirm. It then shows six digits: type
   them in the page and press "Submit code". The app is uploaded if the device
   does not hold it. The page logs "connected".
5. "Get address" with "show it on the device" ticked: compare the address on the
   device with the one the page prints; confirm on the device.
6. "Sign the transfer": the page logs what the device will show, then the device
   shows the transfer (from, recipient, amount and fee, then hold to confirm).
   The page prints the signature, which it verified against the device's key.
7. "Sign the message": read it on the device and hold to confirm.
8. Unplug the cable during step 6 or 7: the page logs `disconnected` and says the
   request had been sent (`outcomeUnknown`) when it was.
9. Reload the page and press "Reconnect (no picker, after a first connect)": no
   picker, no code. "Forget the credential" removes the record; the next connect
   asks for a code again.

**The script** (Node, address and one signature):

1. `pnpm --filter @thru/trezor build`; the `usb` package is a development
   dependency of this package, so `pnpm install` has installed it (a prebuilt
   binary; nothing is compiled).
2. `node scripts/device-check.mjs --tapp <app>.tapp --proof <app>.proof --root-packet <root packet>`
   (from `web/packages/trezor`; `--root-packet` can be left out when the files lie
   as the app build writes them). Type the six digits when asked (first run only;
   the credential is kept in `~/.config/thru/trezor-web-host-pairing.json`, mode
   0600). Compare the address on the device with the printed one and confirm, then
   read the message on the device and hold to confirm. It prints `PASSED`, or the
   typed error and exits 1.

## Not covered

A run on a physical Safe 7 (the steps above are the run); other browsers than
Chromium ones (WebUSB does not exist elsewhere); other operating systems than
macOS for the tests; a device held by Trezor Suite or the Bridge beyond the
`busy` error a fake produces; the real `usb` package (never imported by a test);
a persistent browser profile across restarts on disk (the browser run restores
IndexedDB through Playwright's storage state); the wallet; the chain scenarios of
`e2e-tests` (written, typechecked and linted, never run); a cancelled passphrase
entry (the Safe 7's keyboard has no way to cancel it, so the emulator cannot show
one); a refusal through the menu at a step that has no menu (`High fee`); the
screens of a retail device or of another model than the Safe 7 (the emulator runs
T3W1 in English); the image cases on firmware that does not compare fingerprints.
