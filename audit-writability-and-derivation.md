# Writability and seed-derivation defects in the TypeScript SDK

**Scope:** `web/packages` — `programs`, `bridge`, `wallet`, `passkey`, `sdk/thru-ts-client-sdk`.
**Cross-checked against:** `rpc/thru-base` and `rpc/cli`; the published `@thru/programs@0.5.2` /
`@thru/sdk@0.5.2` tarballs; the `Unto-Labs/thru@main` contents API (2026-11-18); and the
[official docs](https://thru.org/docs/sdks/web-packages/programs/).

**Status:** the three defects in this PR (**#1, #6, #8**) all still reproduce in upstream `main` and in the
published 0.5.2 build, so this is not a stale fix. **#9** was raised and then withdrawn — truncation is documented.
**#2–#5** need a maintainer to confirm the on-chain handlers and are deliberately out.

---

## Summary

| # | Where | Class | Severity | In this PR |
|---|-------|-------|----------|------------|
| 1 | `perp/sdk/tx.ts` margin owner | account missing from lists | **High** | **fixed** |
| 2 | `clob/exchange.ts` source market | read-only used as write | **High** | deferred |
| 3 | `bridge/.../thruToPolygon.ts` | mint marked writable | Medium | deferred |
| 4 | `perp/sdk/tx.ts` margin account | read-only used as write? | Medium | deferred |
| 5 | `perp/index.ts` market seed | PDA collision | Medium | deferred |
| 6 | `token/{format,derivation,initialize-mint}.ts` | invalid hex → `0x00` | Medium | **fixed** |
| 7 | `sdk/.../compression/instructions.ts` | authority index coupling | Low | deferred |
| 8 | `wallet/crypto.ts` | no DER bounds checks | Low | **fixed** |
| 9 | `oracle/derivation.ts` | seed truncation | **Not a bug** | withdrawn |
| 10 | `deploy/workflows.ts` upgrade | `abi_meta` read-only | **Not a bug** | — |
| 11 | AMM builders / `buildPasskeyReadWriteAccounts` | dead code | Info | — |

## Why this class of bug matters

A Thru transaction carries an explicit split between read-write and read-only accounts, and nothing validates that
the split matches what the program mutates. `TransactionBuilder` only dedupes; the order is always
`[feePayer, program, ...sortedReadWrite, ...sortedReadOnly]`, with no promotion of a read-only account to writable.
A mismatch surfaces as a revert *after* signing and paying. Over-declaring costs state units per writable
footprint, so the error runs both ways.

---

## 1. Margin account owner is never added to the account lists — HIGH — **fixed**

**File:** `perp/sdk/tx.ts` — `marginAccountCreateTx`, `marginTransferTx`.

Both encode the owner's index (`set_owner_account_idx`) but omitted the owner from their lists:

```ts
[margin.address],                // readWrite   — create
[vault]                          // readOnly
[from.seatArena, to.seatArena],  // readWrite   — transfer
[]                               // readOnly
```

A keypair signer resolves the owner only when it is the fee payer (index 0); otherwise `encodePerpTransaction`
throws `account … is not in the transaction`. A wallet signer resolves it only because the wallet address is
injected into `readWriteAccounts`, i.e. only when `owner === wallet`. The tests missed it because they build with
`feePayer = OWNER`.

**Fix:** the owner joins `readOnly` in both builders. Read-only is deliberate — the program rejects a non-owner
caller with `MARGIN_UNAUTHORIZED` (`-227`, *"the signer is not the margin account owner"*), so authorisation comes
from the fee-payer signature, not account writability. `perpTransactionAccountOrder` dedupes *before* filtering the
fee payer, so `owner === feePayer` still yields one entry.

*Assumption:* Thru has a single signature slot, so the owner can only be authorised as fee payer. If co-signing
arrives the owner becomes a signer, not a plain read-only account; the tests assert the index resolves to the
owner, which holds either way.

## 2. CLOB source-market accounts must be writable even when only read — HIGH, program-side — **deferred**

**File:** `clob/exchange.ts` — `addSourceMarketAccounts`. The source market is only read (tokens leave the
*target* vault), yet three source accounts are marked writable because on-chain `market_record` calls
`tsys_set_account_data_writable()` on all five unconditionally. Declaring them read-only traps before the
withdrawal runs. The proper fix is on-chain; the SDK workaround should stay but be documented as one.

## 3. Bridge deposit marks the token mint read-write — MEDIUM — **deferred**

**File:** `bridge/src/client/thruToPolygon.ts` — `buildThruToPolygonDepositAccountLists`. A transfer changes
token-account balances, not mint supply, so the mint likely belongs in `readOnlyAccounts`; an extra writable
account costs state units on every deposit. Needs the handler confirmed. *(Depositor index resolution checked and
correct.)*

## 4. Perp margin account carried read-only on trading paths — MEDIUM — **deferred**

**File:** `perp/sdk/tx.ts` — `withMarginRecord(…, writable = false)`. `crossAware` never passes `true`, so orders,
deposits, withdrawals, modifies and liquidations carry the margin account read-only; only link/unlink mark it
writable. If any of those paths writes it, they revert. The SDK is deliberately asserting read-only — do not change
without the handler.

## 5. Perp market PDA seed omits the base mint — MEDIUM, on-chain — **deferred**

**File:** `perp/index.ts` — `derivePerpMarketAccounts`. `base = sha256(authority || lotSize || tickSize ||
priceCap || quoteMint || initialMarginBps)` — the underlying mint is absent, so two markets differing only by
underlying derive identical arenas. Structurally the same collision as the AMM vault bug. CLOB's
`createMarketCreateInstruction` takes both mints explicitly; worth asking whether the base mint belongs in perp
market identity.

## 6. `hexToBytes` silently maps invalid hex to `0x00` — MEDIUM, three copies — **fixed**

**Files:** `token/format.ts`, `token/instructions/initialize-mint.ts`, `token/derivation.ts` (used by
`deriveMintAddress`). All three did:

```ts
const byte = Number.parseInt(hex.slice(i, i + 2), 16);
out[i] = byte;   // NaN assigned into a Uint8Array becomes 0
```

So a seed with a typo derived a **different, valid-looking address** instead of throwing — for
`deriveMintAddress` and `initialize_mint`'s `seedHex`, a transaction against an account nobody controls.

**Fix:** reject any character outside `[0-9a-fA-F]` with `Hex string contains invalid characters`, matching
`@thru/sdk` (which checks `Number.isNaN`). The odd-length error is unchanged.

**Exhaustiveness.** Every `parseInt(x, 16)` in `web/packages/*/src` was swept, because an earlier draft wrongly
called `perp/sdk/instructions.ts:137` a fourth lenient copy — it already rejects with `/[^0-9a-f]/i` in the base
commit. The remaining sites are all guarded: that one by regex, `core-manager/{live-state,plan}` by
`^[0-9a-f]{64}$`, `wallet/encoding.ts` by delegation to `@thru/sdk`. **The three fixed here were the only lenient
decoders**, so no follow-up is owed.

## 7. Compression uploader: authority index coupling — LOW, fragile not broken — **deferred**

Index coupling between the uploader authority and the instruction payload; works today, breaks quietly if list
order changes.

## 8. `parseDerSignature` has no bounds checks — LOW — **fixed**

**File:** `wallet/crypto.ts`. `slice` clamps silently, so truncated DER produced a plausible wrong `r`/`s` rather
than throwing. The sequence length and both INTEGER lengths are now checked; a zero length, a component over 33
bytes (sign byte + 32), a missing tag and a non-short length form all throw `Invalid DER signature: …`. Valid
short-form signatures parse byte-identically, including the 33-byte leading-`0x00` form, so the passkey fixtures
are unchanged. Input comes from WebAuthn rather than user text, so exposure is low — but a parser that accepts
malformed input is unsound by default.

## 9. Oracle feed seed silently truncates to 32 bytes — WITHDRAWN: documented behaviour

Padded **or truncated** to 32 bytes, so two labels sharing their first 32 bytes derive one feed PDA. I raised this
and started by throwing on over-long input, then **reverted it**. Truncation is the contract: the official docs
state *"String seeds are UTF-8 encoded, truncated to 32 bytes, and zero-padded when shorter"*, and the published
`dist/oracle/index.js` implements exactly that. Throwing would have been a breaking change to a documented public
function. `derivation.ts` is byte-identical to base; the test pins truncation instead, including the collision:

```ts
expect(normalizeOracleFeedSeed(prefix + "6789")).toEqual(
  normalizeOracleFeedSeed(prefix + "different"),
);
```

If strictness is wanted, the non-breaking route is an opt-in `assertSeedFits` helper.

## 10. Deploy upgrade paths mark `abi_meta` read-only — NOT A BUG

I flagged this, then disproved it: `TransactionBuilder::build_abi_manager_upgrade_abi_official`
(`rpc/thru-base/src/txn_tools.rs:3100`) lists `abi_meta` read-only too. The ABI revision lives in the content
account, not the metadata. Recorded so it is not re-opened.

## 11. Dead code — informational

AMM builders `createInitPoolInstruction`, `createAddLiquidityInstruction`, `createWithdrawLiquidityInstruction`,
`createSwapInstruction` have zero callers in `web/packages`, so any writability bug in them is latent.
`buildPasskeyReadWriteAccounts` is exported with zero callers.

---

## Checked and correct

`deriveTokenAccountAddress` (32-byte seed, owner+mint bound) · wallet deposit · `wrapClobPlanWithTokenAccountInitialization` ·
perp sha256-label derivations · CLOB/perp `exchange_meta` `fixedSeed` (per-program singleton) · bootstrap
`stateAddress` labels · manager/multisig derivations · uploader chained derivation · ABI manager derivation ·
token `transfer_checked` (mint read-only, matches the program) · governance layouts in `core-manager/plan.ts` ·
`wallet/seeds.ts` · deploy uploader (`[meta, buffer]` read-write) · wallet session renewal · passkey
add-device/create-wallet · `perp/sdk/submit.ts` · `marginAccountIds` probing · `mintAccountCreateTx` state units
(margin account is `PERP_MARGIN_ACCOUNT_SIZE` = 432 bytes, so `ceil((64+432)/4096) = 1`, sufficient).

## Scope of the accompanying PR

**In:** #1, #6, #8 — confined to `web/packages/programs/src`, nothing needed from the program: they add an account
to a list or reject malformed input. Each has a regression test that fails on the old code, and each reproduces in
upstream `main` and in the published 0.5.2 build.

**Withdrawn:** #9 — see above.

**Out, on purpose:** #2–#5. Each needs a maintainer to confirm what the on-chain handler actually writes (or, for
#5, whether the base mint belongs in perp market identity). Changing writability on a guess either reverts every
transaction on that path or silently narrows a writable set the program depends on. #7 is documentation/ergonomics.

**Suggested order for the rest:** #2 (on-chain fix, keep the SDK workaround documented) → #7 → #3, #4, #5 →
#9 (decide whether truncation stays as-is or gains an opt-in strict helper).

**No action:** #10 (confirmed correct), #11 (dead code).

**Not in this report:** the AMM pool-vault collision, fixed separately in `2f66621`.
