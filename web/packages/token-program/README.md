# @thru/token-program

TypeScript bindings for the Thru on-chain token program. Provides instruction builders, account parsers, address derivation, and formatting utilities for creating and managing tokens on the Thru network.

## Installation

```bash
pnpm add @thru/token-program
```

Peer dependencies: `@thru/helpers`, `@thru/thru-sdk`.

## Basic Usage

### Create a new token mint

```typescript
import {
  createInitializeMintInstruction,
  deriveMintAddress,
} from '@thru/token-program';

const { address, bytes, derivedSeed } = deriveMintAddress(
  mintAuthorityAddress,
  seedHex,
  tokenProgramAddress
);

const instruction = createInitializeMintInstruction({
  mintAccountBytes: bytes,
  decimals: 6,
  mintAuthorityBytes: authorityBytes,
  ticker: 'MYTOKEN',
  seedHex,
  stateProof,
});
```

### Initialize a token account

```typescript
import {
  createInitializeAccountInstruction,
  deriveTokenAccountAddress,
} from '@thru/token-program';

const { bytes: tokenAccountBytes, derivedSeed } = deriveTokenAccountAddress(
  ownerAddress,
  mintAddress,
  tokenProgramAddress
);

const instruction = createInitializeAccountInstruction({
  tokenAccountBytes,
  mintAccountBytes,
  ownerAccountBytes,
  seedBytes: derivedSeed,
  stateProof,
});
```

### Transfer tokens

```typescript
import { createTransferInstruction } from '@thru/token-program';

const instruction = createTransferInstruction({
  sourceAccountBytes,
  destinationAccountBytes,
  amount: 1_000_000n,
});
```

### Parse on-chain account data

```typescript
import { parseMintAccountData, parseTokenAccountData } from '@thru/token-program';

const mintInfo = parseMintAccountData(account);
// { decimals, supply, creator, mintAuthority, freezeAuthority, ticker, ... }

const tokenInfo = parseTokenAccountData(account);
// { mint, owner, amount, isFrozen }
```

### Format token amounts for display

```typescript
import { formatRawAmount } from '@thru/token-program';

formatRawAmount(1_500_000n, 6); // "1.5"
formatRawAmount(1_000_000n, 6); // "1"
```

## Key Capabilities

- **Instruction builders** -- `createInitializeMintInstruction`, `createInitializeAccountInstruction`, `createMintToInstruction`, `createTransferInstruction`
- **Address derivation** -- `deriveMintAddress`, `deriveTokenAccountAddress`, `deriveWalletSeed`
- **Account parsing** -- `parseMintAccountData`, `parseTokenAccountData` decode raw on-chain data into typed objects
- **Formatting utilities** -- `formatRawAmount`, `bytesToHex`, `hexToBytes`
- **ABI codegen** -- instruction payloads are built using auto-generated builders from the token program ABI

## API Reference

### Instructions

Each instruction builder returns an `InstructionData` function that accepts an `AccountLookupContext` and resolves to the serialized instruction bytes.

| Function | Description |
|---|---|
| `createInitializeMintInstruction(args)` | Create a new token mint with ticker, decimals, and authorities |
| `createInitializeAccountInstruction(args)` | Create a token account for a given owner and mint |
| `createMintToInstruction(args)` | Mint new tokens to a destination account |
| `createTransferInstruction(args)` | Transfer tokens between accounts |
| `buildTokenInstructionBytes(variant, payload)` | Low-level helper to wrap a payload in a token instruction envelope |

### Derivation

| Function | Description |
|---|---|
| `deriveMintAddress(authority, seed, programAddress)` | Derive the deterministic address for a token mint |
| `deriveTokenAccountAddress(owner, mint, programAddress, seed?)` | Derive the deterministic address for a token account |
| `deriveWalletSeed(walletAddress, extraSeeds?)` | Derive a seed from a wallet address |

### Account Parsing

| Function | Description |
|---|---|
| `parseMintAccountData(account)` | Parse raw account data into `MintAccountInfo` |
| `parseTokenAccountData(account)` | Parse raw account data into `TokenAccountInfo` |
| `isAccountNotFoundError(err)` | Check if an error represents a missing account (code 5) |

### Types

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

| Constant | Value | Description |
|---|---|---|
| `PUBKEY_LENGTH` | `32` | Length of a public key in bytes |
| `TICKER_MAX_LENGTH` | `8` | Maximum ticker string length |
| `ZERO_PUBKEY` | `Uint8Array(32)` | 32 zero bytes, used as a null public key |

## Build

```bash
pnpm build    # Build with tsup (CJS + ESM + .d.ts)
pnpm dev      # Watch mode
pnpm clean    # Remove dist/
```
