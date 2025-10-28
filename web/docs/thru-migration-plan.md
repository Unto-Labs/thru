# Thru Migration Planning Notes

_Last updated: 2025-02-14_

This document captures the initial assessment for migrating the wallet stack
from a Solana-only implementation to first-class Thru support. It summarizes
where Solana dependencies live today, what the current Thru SDK provides, the
gaps to close, and a proposed migration outline plus open questions.

---

## 1. Current State (Post Phase 2/3)

- **Wallet core (`wallet/src/lib/wallet/wallet-manager.ts`)**
  - Derives Thru addresses via `ThruHDWallet`, persists them with
    `AddressType.THRU`, and reads balances through `ThruClient`.
- **Worker & key management (`wallet/src/workers/key-manager.ts`)**
  - Signs base64 Thru wire payloads with `@noble/ed25519`; Solana/Gill helpers
    have been removed.
- **Key derivation (`thru-wallet-sdk/packages/crypto/src/hdwallet.ts`)**
  - Supports both legacy Solana helpers and the new Thru coin type `9999`, with
    address encoding delegated to the shared Thru SDK helpers.
- **SDK surface (`thru-wallet-sdk/packages/*`)**
  - Browser and React SDKs expose the Thru chain (`IThruChain`), and the iframe
    bridge now relays base64 wire transactions instead of Gill objects.
- **UI/UX**
  - Embedded wallet flows return Thru addresses, and the sample dApp focuses on
    connection/address listing while Thru transaction builders are scoped for a
    later phase.

---

## 2. Thru SDK Snapshot (What Exists Today)

- **Client bootstrap** via `createThruClient` (`…/sdk.ts`) returning bound
  modules for accounts, blocks, proofs, streaming, and transactions.
- **Accounts API** (`modules/accounts.ts`) retrieves account metadata including
  balances (BigInt) and owners for a 32-byte pubkey.
- **Transactions API** (`modules/transactions.ts`)
  - Builds transactions with automatic nonce/slot lookups.
  - Accepts 32-byte fee payer private keys and outputs raw wire bytes plus
    signatures (encoded via `helpers.encodeSignature` / `decodeSignature`).
  - Lacks a high-level helper for “native token transfer”.
- **Helpers (`modules/helpers.ts`)**
  - Canonical address/signature encoding (`ta…` / `ts…`) with checksum.
  - Program address derivation (`deriveProgramAddress`).
- **Reference usage**
  - `wallet/app/test/page.tsx` showcases instruction assembly, signing with
    `sdk.transactions.buildAndSign`, sending raw bytes, and streaming
    confirmations.

---

## 3. Parity Gaps to Close

1. **Key Material & Storage**
   - ✅ Thru derivation (coin type `9999`) is wired through `ThruHDWallet`; we now
     persist `AddressType.THRU` along with optional raw public-key bytes.

2. **Worker Signing**
   - ✅ Worker signs base64 Thru transactions; message signing can be layered on
     later if dApps request it.

3. **Wallet RPC & Transfers**
   - ✅ Balance queries use the Thru SDK client. Native token transfer helpers are
     still TODO (tracked under Deferred Items).

4. **SDK Bridge & Protocol**
   - ✅ Embedded provider now exposes an `IThruChain`, and postMessage shuttles
     base64 wire transactions end-to-end.

5. **UI & Developer Surface**
   - ⚙️ Follow-up: polish Thru-centric copy and extend the sample dApp once native
     transfer builders land.

---

## 4. Migration Outline

1. **Introduce Chain Abstraction**
   - Expand `AddressType`, context state, and postMessage payloads to support
     both Solana and Thru ahead of the swap.

2. **Implement Thru Key Derivation**
   - Add a derivation helper in `@thru/crypto` using BIP44 coin type `9999`
     that returns raw 32-byte private keys and encoded public addresses.
   - Update account storage schemas (IndexedDB) to persist both formats during
     migration.

3. **Rework Worker & Wallet Logic**
   - Teach the worker to sign Thru transactions/messages and emit encoded
     signatures.
   - Migrate balance queries to Thru SDK modules. (Transfer helpers can be
     layered in later; no `sendTransfer` implementation is required yet.)

4. **Extend the SDK Bridge**
   - Implement an `EmbeddedThruChain`, add postMessage request/response enums,
     move the bridge to base64-encoded `Transaction.toWire()` payloads, update
     the Browser SDK to expose `sdk.thru`, and create new React hooks (`useThru`,
     `useThruChain`, etc.). Message-signing flows can remain out of scope until
     a dApp requests them.

5. **UI/UX & DX Cleanup**
   - Replace SOL-specific UI elements with Thru equivalents.
   - Convert the test dApp to use the Thru chain.
   - Produce migration documentation and regression tests (key derivation,
     signing round-trip, protocol handshake).

Each phase should land with accompanying tests (unit + integration) to ensure we
maintain parity as we step away from Solana dependencies.

---

## 5. Deferred Items

- **Native Transfer Helper**
  - Full native-token transfer support will be tackled after the initial Thru
    cutover; for now the wallet can defer implementing `sendTransfer`.

- **Message Signing**
  - Arbitrary message-signing APIs are out of scope for the first release and
    can be added once a dApp requests them.

These items can remain on the backlog while the primary migration unblocks the
counter-style transaction flow.

---

## 6. Immediate Next Steps

- Socialize the BIP44 coin type (`9999`) decision with protocol/crypto teams.
- Design the native transfer helper (SDK vs. wallet responsibility) and capture
  the instruction schema.
- Document expectations for future message-signing support so dApp requests can
  be scoped quickly.
- Draft regression tests covering derivation, base64 signing, and connect →
  sign → submit flows.

These notes should serve as the jumping-off point for a detailed migration plan
and subsequent implementation tickets.

---

## 7. Performance Considerations (Initial Thoughts)

- **Key Derivation**
  - BIP44/ed25519 derivation (`ed25519-hd-key` + `@noble/ed25519`) runs inside
    the worker; derivation cost is comparable to the previous Solana flow and
    happens infrequently (account creation/unlock).
- **Signing Throughput**
  - `signTransaction`/`signMessage` remain in the worker, so main-thread impact
    stays minimal. Watch for larger Thru transactions (proofs, state data) that
    may increase serialization overhead and memory copies.
- **RPC/Network Latency**
  - Thru gRPC calls (`createThruClient`) are async and can be cached per
    network. Long-polling / streaming (`transactions.track`) should be gated to
    avoid excessive listeners per tab.
- **Storage Format Changes**
  - IndexedDB migrations to store additional key material should be batched
    during unlock to avoid blocking UI; leverage worker to minimize UI thread
    stutter.
- **PostMessage Payload Size**
  - Thru transactions may carry larger payloads than Solana legacy transactions;
    budget for the iframe bridge to handle base64 payloads efficiently and
    consider chunking or compression if needed later.
- **Bridge Encoding**
  - Base64 encoding/decoding of `Transaction.toWire()` buffers is linear in
    payload size and keeps the bridge aligned with the canonical wire format.
- **Message Signing**
  - No message-signing path is planned for the first release; keeping the scope
    to transaction approval simplifies worker/API surface for now.

---

## 8. Phased Task Breakdown

Each phase below ends with a verifiable checkpoint so we can confirm tangible
progress before moving on.

### Phase 1 — Foundation & Derivation

- Update `@thru/chain-interfaces` to add `AddressType.THRU` and guard code paths
  with type-safe enums.
- Introduce Thru BIP44 derivation (coin type `9999`) in `@thru/crypto`, exposing
  helpers for seed → keypair (raw 32-byte private key + `ta…` address).
- Extend IndexedDB schemas (`@thru/indexed-db-stamper`) so stored accounts can
  hold Thru metadata (address type + optional raw key material).
- Adjust wallet domain models (`wallet/src/types/**`) to consume the shared
  stored-account type exported from `@thru/indexed-db-stamper`.

**Checkpoint:** Derive a Thru account inside the worker and persist it to
IndexedDB (inspect via devtools).

### Phase 2 — Worker & Wallet Core

- Teach the worker (`key-manager.ts`, `signer.worker.ts`) to sign base64-encoded
  Thru wire transactions and return encoded payloads.
- Rewire `WalletManager` balance lookups to use `ThruClient`.
- Update wallet state/providers (`WalletProvider`, hooks) to recognize Thru
  accounts and balances.
- Ensure mnemonic import/export continues to work with the new derivation.

**Checkpoint:** Unlock the wallet, list at least one Thru account, and fetch a
non-zero balance using the Thru RPC client.

### Phase 3 — SDK Bridge & Embedded Wallet

- Implement `EmbeddedThruChain` plus matching postMessage request/response
  types that shuttle base64 `Transaction.toWire()` payloads.
- Expose `sdk.thru` (Browser SDK) and add React hooks (`useThru`, etc.) that
  mirror the current Solana ergonomics.
- Update the embedded wallet UI flow to prompt for Thru transaction approvals
  and return signed payloads.
- Harden iframe message handling (origin checks, error propagation) for the new
  payload format.

**Checkpoint:** Run the counter demo via the iframe wallet—dApp constructs an
unsigned Thru transaction, wallet signs it, and the dApp submits it via
`sdk.transactions.send`.

### Phase 4 — UI/UX Alignment & Docs

- Refresh wallet UI copy/formatters to show Thru units and address formatting.
- Update the test dApp and documentation to walk through the Thru integration
  path (connect, sign, submit).
- Document the single-address `StoredAccount` shape (`addressType`, optional raw
  base64 key) and note the shared source of truth in `@thru/indexed-db-stamper`.
- Call out that `ThruHDWallet` relies on `@thru/thru-sdk` helpers, so rebuilds
  must happen whenever the SDK changes its encoding logic.
- Add regression tests (unit + integration) for derivation, signing round-trip,
  and postMessage flows.
- Document known deferred items (native transfers, message signing) with clear
  follow-up tickets.

**Checkpoint:** QA walkthrough covering wallet unlock → connect from test dApp
→ sign Thru transaction → confirm via RPC, with documentation reflecting the
new flow.