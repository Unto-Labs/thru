# @thru/programs

Typed TypeScript clients for Thru's core on-chain programs: token, AMM, CLOB, oracle, multicall, Wallet Program, and others.

## Perpetual futures (`@thru/programs/perps`)

`@thru/programs/perps` is the SDK of the Thru perp program:

- `createPerpsClient`, which reads through the perps indexer or RPC;
- transaction builders for isolated and cross-margined seats;
- keypair, wallet and signing session signers;
- sending on the fast confirm path, with named program errors;
- unit helpers;
- an action catalog with JSON Schemas for LLM agents.

It decodes accounts and events with the program's latest ABI only.
`@thru/programs/perp` is an alias of the same module.

See [src/perp/README.md](./src/perp/README.md) for the SDK.

## Managed program primitives

The deployment system programs have dedicated SDK entry points:

- `@thru/programs/manager` manages seed-derived program accounts.
- `@thru/programs/abi-manager` manages official and external ABI accounts.
- `@thru/programs/uploader` manages temporary bulk-upload accounts.

Each entry point exports canonical program IDs, address derivation, account
parsers, error decoding, generated ABI types, raw instruction builders, and
account-aware instruction callbacks. The callbacks can be passed directly as
`instructionData` when building a transaction with `@thru/sdk`.

```typescript
import {
  deriveManagedProgramAddresses,
  createUpgradeProgramInstruction,
} from "@thru/programs/manager";

const addresses = deriveManagedProgramAddresses("nft");
const instructionData = createUpgradeProgramInstruction({
  metaAccount: metaAddressBytes,
  programAccount: programAddressBytes,
  sourceBufferAccount: uploadBufferAddressBytes,
  sourceSize: programBytes.length,
  // SHA-256 of exactly the uploaded bytes; the manager rejects any others.
  sourceSha256: new Uint8Array(await crypto.subtle.digest("SHA-256", programBytes)),
});
```

These modules encode individual program calls. Multi-transaction upload,
signing, retry, atomic deployment, and verification policy belongs in the
deployment workflow rather than these low-level SDKs.

## Managed program deployment

`@thru/programs/deploy` uploads and manages program images and official ABIs
using `@thru/sdk`. A combined program and ABI deploy or upgrade commits both
artifacts in one multicall transaction.

```typescript
import { readFile } from "node:fs/promises";
import { deploy, type DeployProgramResult } from "@thru/programs/deploy";

const result: DeployProgramResult = await deploy.deployProgram({
  seed: "nft",
  signer: {
    address: "ta...",
    privateKey: process.env.THRU_PRIVATE_KEY!,
  },
  program: await readFile("./nft.bin"),
  abi: await readFile("./nft.abi.yaml"),
  onProgress: (event) => console.log(event.phase, event.status),
});

console.log(result.programAccountAddress, result.transactionSignature);
```

The same namespace exposes `deployProgramABI`, `upgradeProgram`, and
`upgradeProgramABI`. Each operation is also exported directly. Create methods
fail before uploading when a final account already exists. Upgrade methods
require open accounts controlled by the signer.

`inspectProgramDeployment` provides the same canonical ownership, authority,
relationship, and optional byte checks without submitting a transaction. It
reports program and ABI account pairs as `missing`, `partial`, or `present`.

Program deployment, upgrade and inspection accept `managerProgramAddress` to
select the parent Manager executable for both PDA derivation and ownership
checks. It defaults to the canonical main Manager. To upgrade the main Manager
itself, provide the root Manager address, the main Manager's seed and its upgrade
authority signer. Non-default parents support binary-only operations: official
ABI publication authenticates metadata owned by the canonical main Manager and
is rejected before uploading when another parent is selected. The immutable
root has no managed metadata and cannot be upgraded through this workflow.

Results include the authority, derived program and ABI addresses, program
version or ABI revision, artifact sizes, the final signature, warnings, and an
`UploadArtifactResult` for each upload. Upload details include temporary
addresses, SHA-256, resume status, all submission signatures, and cleanup
status. Temporary-account cleanup is best effort; cleanup failures are returned
as warnings and do not change a successful final transaction.
Cleanup waits for its executed transaction to become indexed before verifying
account absence. This visibility wait shares the transaction's 60-second
deadline and retries only `NOT_FOUND` or a receipt without a nonzero slot.

Failures throw `DeployError`. Its stable `code` is one of `INVALID_INPUT`,
`SIGNER_MISMATCH`, `TARGET_EXISTS`, `TARGET_NOT_FOUND`, `TARGET_FINALIZED`,
`UPLOAD_CONFLICT`, `TRANSACTION_FAILED`, `VERIFICATION_FAILED`,
`OUTCOME_UNKNOWN`, or `RPC_ERROR`. When available, the error also includes the
phase, transaction signature, VM/user error codes, derived addresses, and
cleanup results.

Program images must use managed image version 1 and end in an eight-byte zero
trailer. ABI input must be valid, self-contained UTF-8 YAML; prepare or flatten
local path imports before publishing. The default upload chunk size is 30,720
bytes and may be set from 1,024 through 31,000 bytes.

### Core program manager transaction layouts

`buildCoreOperationPlan` and `buildGovernedABIOperationPlan` bind the transaction
program and fixed account indices before review. They use atomic Multicall by
default. When canonical Multicall is itself an operand, they instead use direct
Core/ABI Manager execution for an EOA admin, or direct canonical Multisig
execution for a Multisig admin. This supports pausing, upgrading, resuming and
managing the official ABI of Multicall without executing it. Set
`executionMode: 'direct'` explicitly to govern other accounts while Multicall
is unavailable. The selected program occupies slot 1; additional accounts
start at slot 2, and Multisig request references include slot 1.

`proposeMultisigRequest`, `approveMultisigRequest` and `executeMultisigRequest`
preserve this layout through voting and execution. For direct permanent Core
creation, the submission helpers first submit and confirm a separate Core
proof-slot refresh, then submit the approved creation. **That refresh and
creation are not atomic.** A successful result includes
`proof_refresh_transaction_id` as well as `transaction_id`; a failed creation
does not undo the refresh. Low-level consumers must use
`buildGovernanceTransactions` or `buildMultisigExecutionTransactions` and confirm
each returned transaction in order. The singular builders reject this two-
transaction path rather than silently omitting the refresh. Ordinary Multicall
permanent creation continues to refresh and consume proofs atomically.

Reviewed Core and official-ABI execution compares the explicitly approved program
state with live accounts before submission and again before issuing a successful
receipt. This includes reviewed executable commitments, metadata versions and
lifecycle, authorities, exact account flags, and ABI revisions and content.
Stale before-state prevents submission; direct creation rechecks it after the
separate proof refresh. Before checking after-state, reviewed execution waits
for `transactions.get` to report an indexed transaction with a nonzero slot:
execution notifications can arrive before account queries see the changes.
Like the CLI, this visibility wait polls every 500 ms, retries only `NOT_FOUND`
or a transaction without a nonzero slot, and shares the execution's 60-second
deadline. It never retries the transaction or a state mismatch. Proposal,
approval and proof refresh do not approve or verify an unexecuted after-state.

Core and official-ABI creation reviews bind exact runtime flags separately for
each created account. Fresh permanent accounts receive `NEW` (`32`); permanent
revival preserves prior flags except `DELETED` and `RECEIVE_NATIVE`. Ephemeral
creation resets flags to `EPHEMERAL` (`8`), without `NEW`. Core also sets executable
`PROGRAM` and applies the requested pin bit without clearing inherited permanent
pins. Invalid before-state classes or impossible after-state flags are rejected
before submission, rather than executing successfully and then withholding the
receipt. This rule covers ABI metadata and content creation independently.

Destruction reviews classify the executable and metadata independently. Deletion
clears `RECEIVE_NATIVE` and adds `DELETED` for `NEW` or `EPHEMERAL` accounts;
Core also clears executable `PROGRAM`. Reviewed removable terminal accounts may
be exact empty corpses or absent from RPC. Older permanent accounts must remain
present and empty. ABI close deletes only content, never its metadata. Missing
nonterminal accounts, RPC errors, owner/flag drift and resurrection still fail.
All other reviewed program flags remain exact; `NEW` is not masked here.

A reviewed Core proposal or acceptance of a Multisig admin must include that
candidate's explicit descriptor in `roles.after.multisigs`, even for an existing
role. Reviewed flags must be `0` or `UNCOMPRESSABLE` (`4`); descriptors containing
`NEW` are rejected. Submission compares its canonical owner, durable flags,
ordered members and threshold with live state before submission and again after
execution. Only the live account's transient `NEW` bit (`32`) is ignored, so it
may clear between these checks without invalidating the reviewed descriptor.
Reviewed values are never populated from RPC observations. If index visibility
or any post-execution state check fails, `GovernanceReceiptWithheldError.receipt.transaction_id`
identifies the transaction that already executed; no successful reviewed-state
receipt is returned, and the expected-state manifest must not advance. These
checks detect drift but do not provide atomic concurrency protection.

## Oracle read SDK

`@thru/programs/oracle` provides typed, ABI-backed helpers for applications that
read Oracle feeds. It supports deterministic feed-address derivation, price and
boolean feed decoding, update-event decoding, and program-error mapping.

The TypeScript API is read-only. Oracle reporters and other services that submit
updates should use the Rust SDK.

### Installation

```bash
pnpm add @thru/programs @thru/sdk
```

### Derive and read a feed

```typescript
import { createThruClient } from "@thru/sdk/client";
import {
  deriveOracleFeedAddress,
  ORACLE_PROGRAM_ADDRESS,
  parseOracleFeedAccount,
} from "@thru/programs/oracle";

const thru = createThruClient({
  baseUrl: "https://rpc.betanet.thru.org",
});
const { address: feedAddress } = deriveOracleFeedAddress(
  thru,
  ORACLE_PROGRAM_ADDRESS,
  "btc-usd:ticker@coinbase",
);

const account = await thru.accounts.get(feedAddress);
const feed = parseOracleFeedAccount(account);

if (feed.kind === "price") {
  console.log({
    name: feed.common.feedName,
    price: feed.price,
    exponent: feed.exponent,
    lastUpdateNs: feed.common.lastUpdateNs,
  });
} else {
  console.log({
    name: feed.common.feedName,
    value: feed.value,
    lastUpdateNs: feed.common.lastUpdateNs,
  });
}
```

Prices and nanosecond timestamps are returned as `bigint`. A price's decimal
value is `price * 10^exponent`; callers should retain integer arithmetic until
formatting the value for display.

### Decode an update event

Pass the raw event payload returned by the transaction or event API:

```typescript
import { parseOracleEvent } from "@thru/programs/oracle";

const update = parseOracleEvent(eventData);

if (update.kind === "priceUpdate") {
  console.log(update.feedAddress, update.oldPrice, update.newPrice);
} else {
  console.log(update.feedAddress, update.oldValue, update.newValue);
}
```

### Decode a program error

```typescript
import {
  OracleProgramError,
  oracleProgramErrorFromCode,
} from "@thru/programs/oracle";

const error = oracleProgramErrorFromCode(userErrorCode);
if (error === OracleProgramError.UpdateTooStale) {
  // Reject or retry the stale update according to the application policy.
}
```

Unknown error codes return `null`.

### API reference

| Export                                                | Description                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| `deriveOracleFeedAddress(thru, programAddress, seed)` | Derive a permanent Oracle feed address and return its normalized seed           |
| `normalizeOracleFeedSeed(seed)`                       | Convert a string or byte array to the 32-byte seed used by the program          |
| `parseOracleFeedAccount(account)`                     | Decode an SDK `Account` or raw account bytes into a typed price or boolean feed |
| `parseOracleEvent(data)`                              | Decode raw event bytes into a typed price or boolean update event               |
| `oracleProgramErrorFromCode(code)`                    | Map a numeric user-error code to `OracleProgramError`, or return `null`         |

String seeds are UTF-8 encoded, truncated to 32 bytes, and zero-padded when
shorter. Feed and event parsers require the complete raw payload and reject
unknown feed types, malformed lengths, and invalid boolean values.

## Token SDK

### Installation

```bash
pnpm add @thru/programs @thru/sdk
```

### Basic Usage

#### Create a new token mint

```typescript
import {
  createInitializeMintInstruction,
  deriveMintAddress,
} from "@thru/programs/token";

const { address, bytes, derivedSeed } = deriveMintAddress(
  mintAuthorityAddress,
  seedHex,
  tokenProgramAddress,
);

const instruction = createInitializeMintInstruction({
  mintAccountBytes: bytes,
  decimals: 6,
  mintAuthorityBytes: authorityBytes,
  ticker: "MYTOKEN",
  seedHex,
  stateProof,
});
```

#### Initialize a token account

```typescript
import {
  createInitializeAccountInstruction,
  deriveTokenAccountAddress,
} from "@thru/programs/token";

const { bytes: tokenAccountBytes, derivedSeed } = deriveTokenAccountAddress(
  ownerAddress,
  mintAddress,
  tokenProgramAddress,
);

const instruction = createInitializeAccountInstruction({
  tokenAccountBytes,
  mintAccountBytes,
  ownerAccountBytes,
  seedBytes: derivedSeed,
  stateProof,
});
```

#### Transfer tokens

```typescript
import { createTransferInstruction } from "@thru/programs/token";

const instruction = createTransferInstruction({
  sourceAccountBytes,
  destinationAccountBytes,
  amount: 1_000_000n,
});
```

#### Transfer tokens with a checked mint, decimals and ticker

`createTransferCheckedInstruction` names the mint account and the decimals and
ticker you expect. The token program reverts unless they match the mint, so a
signer that reviews the instruction bytes, such as a hardware wallet, can show
the token and the amount in whole units. The program only reads the mint
account: list it in the transaction's read-only accounts.

```typescript
import {
  TokenMintAccount,
  createTransferCheckedInstruction,
} from "@thru/programs/token";

const mintData = mintAccount.data?.data;
const mint = mintData ? TokenMintAccount.from_array(mintData) : null;
if (!mint) throw new Error("Not a mint account");
const tickerField = mint.get_ticker();

const instruction = createTransferCheckedInstruction({
  sourceAccountBytes,
  destinationAccountBytes,
  mintAccountBytes,
  amount: 1_000_000n,
  decimals: mint.get_decimals(),
  // The stored ticker bytes, without the unused padding.
  ticker: Uint8Array.from(tickerField.get_bytes()).subarray(
    0,
    tickerField.get_length(),
  ),
});
```

The ticker must equal the bytes stored in the mint, so read them from the mint
account as shown. `parseMintAccountData` returns the ticker as display text
with trailing zero bytes removed, which does not reproduce every stored
ticker. You can pass a string when you know the stored ticker is plain text.
It is encoded as UTF-8 exactly as given.

#### Parse on-chain account data

```typescript
import {
  parseMintAccountData,
  parseTokenAccountData,
} from "@thru/programs/token";

const mintInfo = parseMintAccountData(account);
// { decimals, supply, creator, mintAuthority, freezeAuthority, ticker, ... }

const tokenInfo = parseTokenAccountData(account);
// { mint, owner, amount, isFrozen }
```

#### Format token amounts for display

```typescript
import { formatRawAmount } from "@thru/programs/token";

formatRawAmount(1_500_000n, 6); // "1.5"
formatRawAmount(1_000_000n, 6); // "1"
```

### Key Capabilities

- **Instruction builders** -- `createInitializeMintInstruction`, `createInitializeAccountInstruction`, `createMintToInstruction`, `createTransferInstruction`, `createTransferCheckedInstruction`
- **Address derivation** -- `deriveMintAddress`, `deriveTokenAccountAddress`, `deriveWalletSeed`
- **Account parsing** -- `parseMintAccountData`, `parseTokenAccountData` decode raw on-chain data into typed objects
- **Formatting utilities** -- `formatRawAmount`, `bytesToHex`, `hexToBytes`
- **ABI codegen** -- instruction payloads are built using auto-generated builders from the token program ABI

### API Reference

#### Instructions

Each instruction builder returns an `InstructionData` function that accepts an `AccountLookupContext` and resolves to the serialized instruction bytes.

| Function                                       | Description                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| `createInitializeMintInstruction(args)`        | Create a new token mint with ticker, decimals, and authorities     |
| `createInitializeAccountInstruction(args)`     | Create a token account for a given owner and mint                  |
| `createMintToInstruction(args)`                | Mint new tokens to a destination account                           |
| `createTransferInstruction(args)`              | Transfer tokens between accounts                                   |
| `createTransferCheckedInstruction(args)`       | Transfer tokens and check the mint, decimals and ticker on chain   |
| `buildTokenInstructionBytes(variant, payload)` | Low-level helper to wrap a payload in a token instruction envelope |

#### Derivation

| Function                                                        | Description                                          |
| --------------------------------------------------------------- | ---------------------------------------------------- |
| `deriveMintAddress(authority, seed, programAddress)`            | Derive the deterministic address for a token mint    |
| `deriveTokenAccountAddress(owner, mint, programAddress, seed?)` | Derive the deterministic address for a token account |
| `deriveWalletSeed(walletAddress, extraSeeds?)`                  | Derive a seed from a wallet address                  |

#### Account Parsing

| Function                         | Description                                             |
| -------------------------------- | ------------------------------------------------------- |
| `parseMintAccountData(account)`  | Parse raw account data into `MintAccountInfo`           |
| `parseTokenAccountData(account)` | Parse raw account data into `TokenAccountInfo`          |
| `isAccountNotFoundError(err)`    | Check if an error represents a missing account (code 5) |

#### Types

```typescript
interface MintAccountInfo {
  decimals: number;
  supply: bigint;
  creator: string;
  mintAuthority: string;
  freezeAuthority: string | null;
  hasFreezeAuthority: boolean;
  ticker: string;
}

interface TokenAccountInfo {
  mint: string;
  owner: string;
  amount: bigint;
  isFrozen: boolean;
}
```

### Constants

| Constant            | Value            | Description                              |
| ------------------- | ---------------- | ---------------------------------------- |
| `PUBKEY_LENGTH`     | `32`             | Length of a public key in bytes          |
| `TICKER_MAX_LENGTH` | `8`              | Maximum ticker string length             |
| `ZERO_PUBKEY`       | `Uint8Array(32)` | 32 zero bytes, used as a null public key |

## Build

```bash
pnpm build    # Build with tsup (CJS + ESM + .d.ts)
pnpm dev      # Watch mode
pnpm clean    # Remove dist/
```
