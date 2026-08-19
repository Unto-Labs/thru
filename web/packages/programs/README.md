# @thru/programs

TypeScript bindings and helpers for Thru on-chain programs.

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

Results include the authority, derived program and ABI addresses, program
version or ABI revision, artifact sizes, the final signature, warnings, and an
`UploadArtifactResult` for each upload. Upload details include temporary
addresses, SHA-256, resume status, all submission signatures, and cleanup
status. Temporary-account cleanup is best effort; cleanup failures are returned
as warnings and do not change a successful final transaction.

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
  parseOracleFeedAccount,
} from "@thru/programs/oracle";

const thru = createThruClient({
  baseUrl: "https://rpc.alphanet.thru.org",
});
const oracleProgramAddress = "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgI";

const { address: feedAddress } = deriveOracleFeedAddress(
  thru,
  oracleProgramAddress,
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

- **Instruction builders** -- `createInitializeMintInstruction`, `createInitializeAccountInstruction`, `createMintToInstruction`, `createTransferInstruction`
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
