# Writability and seed-derivation defects in the TypeScript SDK

**Scope:** `web/packages` — `programs`, `bridge`, `wallet`, `passkey`, `sdk/thru-ts-client-sdk`.
**Cross-checked against:** `rpc/thru-base` (Rust transaction builders) and `rpc/cli`, the reference
implementations the official tooling itself uses.

**Status:** report, plus the fixes for findings **#1, #6, #8 and #9** (the four that are pure TypeScript
with no on-chain dependency). Findings **#2, #3, #4 and #5** need a maintainer to confirm the program
handlers first and are deliberately left out; see [Scope of the accompanying PR](#scope-of-the-accompanying-pr).

**Related:** the AMM pool-vault collision is fixed separately in `2f66621` and is *not* listed here.

---

## Why this class of bug matters

A Thru transaction carries an explicit account list split into read-write and read-only. Nothing in the SDK
validates that the split matches what the program actually mutates:

`web/packages/sdk/thru-ts-client-sdk/domain/transactions/TransactionBuilder.ts` (and the parallel
`modules/transactions.ts`) only deduplicate. The account order is always

```
[feePayer, program, ...sortedReadWrite, ...sortedReadOnly]
```

There is no promotion of a read-only account to read-write, and no check that an account written by an
instruction was declared writable. A mismatch surfaces only as a runtime revert *after* the transaction has been
signed and paid for. The runtime additionally charges state units per writable account footprint
(`perp/index.ts`, state-units comment), so over-declaring costs real fees.

`getAccountIndex` does at least fail fast when an address is in **neither** list
(`Account not found in transaction accounts`), which turns a missing account into a build-time error rather than a
silent one. Finding 4 below is of that shape.

---

## Summary

| # | Where | Class | Severity | Fixable in SDK | In this PR |
|---|-------|-------|----------|----------------|------------|
| 1 | `perp/sdk/tx.ts` margin owner | account missing from lists | **High** | Yes | **fixed** |
| 2 | `clob/exchange.ts` source market | read-only used as write (workaround) | **High** | Workaround only | deferred |
| 3 | `bridge/.../thruToPolygon.ts` | mint marked writable | Medium | Likely | deferred |
| 4 | `perp/sdk/tx.ts` margin account | read-only used as write? | Medium | Needs on-chain check | deferred |
| 5 | `perp/index.ts` market seed | PDA collision | Medium | On-chain | deferred |
| 6 | `token/{format,derivation,initialize-mint}.ts` | invalid hex → `0x00` | Medium | Yes | **fixed** |
| 7 | `sdk/.../compression/instructions.ts` | authority index coupling | Low | Yes | deferred |
| 8 | `wallet/crypto.ts` | no DER bounds checks | Low | Yes | **fixed** |
| 9 | `oracle/derivation.ts` | silent seed truncation | Low | Yes | **fixed** |
| 10 | `deploy/workflows.ts` upgrade | abi_meta read-only | **Not a bug** | — | — |
| 11 | AMM instruction builders / `buildPasskeyReadWriteAccounts` | dead code | Info | — | — |

---

## 1. Margin account owner is never added to the account lists — HIGH, reproducible — **fixed**

**File:** `web/packages/programs/src/perp/sdk/tx.ts` — `marginAccountCreateTx` (~505), `marginTransferTx` (~546).

Both builders encode the owner's account index:

```ts
// createPerpMarginAccountCreateInstruction
.set_owner_account_idx(accountIndex(context, args.ownerAccountBytes))
// createPerpMarginTransferInstruction
.set_owner_account_idx(accountIndex(context, args.ownerAccountBytes))
```

but pass account lists that omit the owner:

```ts
// marginAccountCreateTx
perpTransaction(..., [{ ix: 'margin_account_create', owner, ... }],
  [margin.address],   // readWrite
  [vault]);           // readOnly
// marginTransferTx
perpTransaction(..., [{ ix: 'margin_transfer', ..., owner, ... }],
  [from.seatArena, to.seatArena],  // readWrite
  []);                             // readOnly
```

I verified this by running the real encoders (scratch test, since deleted):

```
marginTransferTx with feePayer !== owner
  accounts: [feePayer, program, ...8 accounts]   owner present? false
  → throws: account taDD… is not in the transaction

marginAccountCreateTx with feePayer !== owner
  accounts: [feePayer, program, margin, vault]   owner absent
```

Behaviour per signer:

* **Keypair signer** (`createKeypairSigner`): builds the transaction straight from `tx.readWrite` / `tx.readOnly`.
  The owner resolves only if it happens to be the fee payer (index 0). Otherwise `encodePerpTransaction` throws.
* **Wallet / session signer** (`signers.ts` → `buildAccountContext`): the wallet address is injected into
  `readWriteAccounts`, so the owner resolves *by accident* when owner === wallet. Any other owner throws.

**Why the tests miss it:** `perp/sdk/tx.test.ts` builds with `feePayer = OWNER`, so the owner is always index 0.
A test with `feePayer !== owner` fails today.

**Fix:** the owner joins the read-only list in both builders (`margin_account_create` and `margin_transfer` read
it; the margin account / seat arenas are what is written). Regression tests in `tx.test.ts` now encode both
builders through `encodePerpTransaction` with a fee payer that is neither the owner nor the margin account, and
check the encoded indices resolve back to the owner.

---

## 2. CLOB source-market accounts must be writable even when only read — HIGH, program-side defect — **deferred**

**File:** `web/packages/programs/src/clob/exchange.ts` — `addSourceMarketAccounts` (~796).

For a cross-market plan the *source* market is only read: tokens leave the **target** market's vault. Yet the SDK
marks three source-market accounts writable:

```ts
accounts.addWrite(sourceMarket.orderArena);
accounts.addWrite(sourceMarket.bidsCbook);
accounts.addWrite(sourceMarket.asksCbook);
```

The SDK comment states why: on-chain `market_record` calls `tsys_set_account_data_writable()` on all five market
accounts unconditionally, whether or not the following instruction writes them. Declaring them read-only traps
before the withdrawal runs — **the exact "account is not writable" symptom that started this investigation.**

Consequences:

* Any caller hand-building a cross-market plan with read-only source accounts hits the same revert.
* Every cross-market transaction pays state units for three accounts the program may never write.

**Proper fix is on-chain.** The SDK workaround should stay, but be documented as a workaround.

---

## 3. Bridge deposit marks the token mint read-write — MEDIUM — **deferred**

**File:** `web/packages/bridge/src/client/thruToPolygon.ts` — `buildThruToPolygonDepositAccountLists` (~301).

```ts
const readWriteAccounts = [
  input.bridgeManagerAddress,
  input.thruTokenAccountAddress,
  input.thruTokenMintAddress,        // <-- mint
  input.feeVaultTokenAccountAddress,
];
const readOnlyAccounts = [input.tokenProgramAddress, input.metadataAccountAddress];
```

A token transfer changes token-account balances, not mint supply. Unless the bridge program mutates the mint
(e.g. tracking circulating supply), the mint belongs in `readOnlyAccounts`. It is currently an extra writable
account on every deposit: wasted state units and a needlessly wide writable set.

**Checked and fine:** the depositor resolves correctly. `depositorAddress = thru.feePayerAddress` (~246), so
`getAccountIndex(depositorAddress)` returns index 0 through `createInstructionContext`'s
`[feePayer, program, ...]` layout. `depositorAddress` correctly never appears in the lists.

**Fix:** confirm the on-chain handler; if the mint is untouched, move it to `readOnlyAccounts`.

---

## 4. Perp margin account carried read-only on trading paths — MEDIUM, needs on-chain confirmation — **deferred**

**File:** `web/packages/programs/src/perp/sdk/tx.ts` — `withMarginRecord(tx, ref, account, writable = false)`.

`crossAware` never passes `writable = true`, so orders, deposits, withdrawals, modifies and liquidations all carry
the margin account **read-only**. Only `marginLinkTx` / `marginUnlinkTx` mark it writable.

Source comments say the margin check is read-only, and tests assert the account is in `readOnly`. If any of those
paths writes the margin account (balance bookkeeping, realised-PnL accrual), the transaction reverts. Do not change
this without checking the on-chain handler — the SDK is deliberately asserting read-only here.

---

## 5. Perp market PDA seed omits the base mint — MEDIUM, on-chain — **deferred**

**File:** `web/packages/programs/src/perp/index.ts` — `derivePerpMarketAccounts` (~1154).

```
base = sha256(authority || lotSize || tickSize || priceCap || quoteMint || initialMarginBps)
```

The base/underlying mint is **not** in the seed. Two perp markets differing only by underlying asset — same
authority, tick/lot, price cap, quote mint and margin parameters — derive identical
`seatArena` / `orderArena` / `bidsCbook` / `asksCbook`. This is structurally the **same collision as the AMM vault
bug**: a shared component (there, the quote mint; here, everything but the base mint) with the distinguishing
asset absent from the derivation.

Note the asymmetry: CLOB's `createMarketCreateInstruction` takes both `base_mint_idx` and `quote_mint_idx`
explicitly. Worth a maintainer question about whether the base mint is meant to be part of perp market identity.

---

## 6. `hexToBytes` silently maps invalid hex to `0x00` — MEDIUM, three copies — **fixed**

**Files:**

* `web/packages/programs/src/token/format.ts`
* `web/packages/programs/src/token/instructions/initialize-mint.ts`
* `web/packages/programs/src/token/derivation.ts` (used by `deriveMintAddress`)

All three did:

```ts
const byte = Number.parseInt(hex.slice(i, i + 2), 16);
out[i] = byte;   // NaN assigned into a Uint8Array becomes 0
```

Verified: `const a = new Uint8Array(1); a[0] = NaN;` → `a[0] === 0`.

So a seed or mint hex string with a typo derives a **different, valid-looking address** instead of throwing. For
`deriveMintAddress` and `initialize_mint`'s `seedHex`, the SDK will happily send a transaction against an address
nobody controls — funds can be minted or deposited to an unreachable account.

**The SDK's own copies are correct:** `sdk/.../helpers.ts` and `sdk/.../abi/utils.ts` check `Number.isNaN` and
throw. The three above now match: a character outside `[0-9a-fA-F]` throws
`Hex string contains invalid characters`, and the odd-length error is unchanged. Tests in
`token/format.test.ts` cover both copies, plus a mistyped real seed through `deriveMintAddress`.

---

## 7. Compression uploader: authority index coupling — LOW, fragile not broken — **deferred**

**Files:** `sdk/.../modules/compression/instructions.ts` (~47), `modules/compression/session.ts` (~63).

```ts
authorityAccountIdx: ctx.getAccountIndex(authority)
```

The upload workflow passes `readWrite = [meta, buffer]` only. The authority therefore has to already be in the
account list for the index to resolve:

* EOA mode: works because `authority` is the fee payer at index 0.
* Wallet mode: works because `buildWalletAccountContext` injects the wallet address.

A caller with a distinct authority that is in neither list gets a build-time
`Account not found in transaction accounts`. Not currently broken, but the coupling is invisible from the
signature. Consider adding the authority to the lists explicitly, or documenting the requirement.

Deploy's uploader is safe: `authority = signer.publicKey = feePayer`.

---

## 8. `parseDerSignature` has no bounds checks — LOW — **fixed**

**File:** `web/packages/programs/src/wallet/crypto.ts`.

Truncated or malformed DER input did not throw; `slice` clamps silently and the parsed `r`/`s` are wrong. Input
comes from WebAuthn rather than user text, so exposure is limited — but malformed input should fail loudly rather
than yield a wrong signature.

**Fixed:** the sequence length and both INTEGER lengths are bounds checked against the input; a zero length, a
component longer than the 33 bytes a P-256 value takes (sign byte plus 32), a missing tag and a length form other
than the short one all throw `Invalid DER signature: …`. Valid short-form signatures, including the 33-byte
leading-`0x00` form and trailing bytes after the declared sequence, parse exactly as before, so the passkey
package's fixtures are unchanged.

---

## 9. Oracle feed seed silently truncates to 32 bytes — LOW — **fixed**

**File:** `web/packages/programs/src/oracle/derivation.ts` — `normalizeOracleFeedSeed`.

Padded **or truncated** to 32 bytes without error. Two distinct caller-supplied seeds sharing their first 32 bytes
derive the same feed PDA. `normalizeOracleFeedSeed` now pads short seeds and throws on input longer than
`ORACLE_FEED_SEED_LENGTH`, so a colliding label can no longer be created by accident.

---

## 10. Deploy upgrade paths mark `abi_meta` read-only — NOT A BUG

**File:** `web/packages/programs/src/deploy/workflows.ts`, combined upgrade (~980) and ABI-only upgrade (~1089).

Both list `context.abi.abiMetaAccountAddress` in `readOnly`, while the *create* paths list it writable. I flagged
this as a candidate, then disproved it: the Rust reference
`TransactionBuilder::build_abi_manager_upgrade_abi_official` (`rpc/thru-base/src/txn_tools.rs:3100`) does the same —

```rust
let mut rw_accounts = vec![(abi_account, "abi")];
let mut r_accounts = vec![(abi_meta_account, "abi_meta"), (program_meta_account, "program_meta"),
                          (srcbuf_account, "srcbuf")];
```

The ABI revision lives in the content account, not the metadata. The TypeScript is correct. Recorded so this is
not re-opened.

---

## 11. Dead code — informational

* AMM instruction builders `createInitPoolInstruction`, `createAddLiquidityInstruction`,
  `createWithdrawLiquidityInstruction`, `createSwapInstruction` — **zero callers** in `web/packages`. Their
  account lists have never been exercised against the program, so any writability bug in them is latent.
* `buildPasskeyReadWriteAccounts` (`domain/programs/wallet/context.ts`) — exported, zero callers.

---

## Checked and correct

Audited and cleared, so this ground is not re-covered:

* `deriveTokenAccountAddress` — enforces a 32-byte seed, binds owner + mint. `TOKEN_ACCOUNT_DEFAULT_SEED` is
  all-zeros, the protocol standard.
* Wallet deposit — `initializeDepositAccount` marks the token account writable, mint and token program read-only.
* `wrapClobPlanWithTokenAccountInitialization` — token account writable; mint, owner, token program read-only.
* Perp sha256-label derivations — bound to market authority.
* CLOB and perp `exchange_meta` `fixedSeed` — per-program singleton, no collision.
* Bootstrap `stateAddress` labels — per-program singletons.
* Manager / multisig derivations — caller-supplied seeds, no static defaults.
* Uploader derivation (`domain/programs/uploader/derivation.ts`) — chained meta → buffer PDA, ephemeral.
* ABI manager derivation — `sha256(kind || body [|| suffix])`, no collision.
* Token `transfer_checked` — mint read-only, matches the program.
* Governance layouts — `core-manager/plan.ts` (`governanceAccountLayout`, `fixedAccountLayout`), multisig
  writable-slot validation, `abi-manager/governance.ts`.
* `wallet/seeds.ts` — manual PDA derivation matches `deriveProgramAddress`; `createWalletSeed` is unambiguous.
* Deploy uploader (`deploy/uploader.ts`, `deploy/chain.ts`) — read-write `[meta, buffer]`, authority = signer.
* Wallet signing-session renewal (`wallet/src/provider/chains/ThruChain.ts`) — empty lists, correct.
* Passkey add-device / create-wallet — lookup account writable.
* `perp/sdk/submit.ts` — flattens read-write + read-only for archive restore; makes no writability claim.
* `marginAccountIds` default `[0, 1, 2, 3]` probing (`perp/sdk/client.ts`).
* `mintAccountCreateTx` state units — `margin_account_create` requests 1 SU; the margin account is 432 bytes
  (`PERP_MARGIN_ACCOUNT_SIZE`), so `ceil((64 + 432) / 4096) = 1`. Sufficient.

---

## Scope of the accompanying PR

**In:** #1 (margin owner), #6 (strict hex decoding), #8 (DER bounds checks), #9 (oracle seed). All four are
confined to `web/packages/programs/src` and need nothing from the program: they either add an account to a list,
reject malformed input, or bound a length. Each has a regression test that fails on the old code.

**Out, on purpose:** #2, #3, #4 and #5. Each needs a maintainer to confirm what the on-chain handler actually
writes (or, for #5, to decide whether the base mint belongs in perp market identity). Changing an account's
writability on a guess either reverts every transaction on that path or silently narrows a writable set the
program depends on, so they belong in their own PR with the program source in hand. #7 is a documentation /
ergonomics change and is left out to keep this PR to the four verified defects.

**Suggested order for the rest:**

1. **#2** (CLOB `market_record` writing all five accounts unconditionally) — the on-chain fix; until then keep the
   SDK workaround and document it as one.
2. **#7** — document or make explicit the uploader authority requirement.
3. **#3** (bridge mint), **#4** (margin account writability), **#5** (perp market seed).

**No action:** **#10** (confirmed correct), **#11** (dead code).
