# @thru/bridge-sdk

TypeScript SDK for Polygon <-> Thru bridge deposits.

## Setup

```ts
import { createBridgeClient } from '@thru/bridge-sdk';

const bridge = createBridgeClient({
  polygon: {
    signer: {
      privateKey: process.env.POLYGON_PRIVATE_KEY!,
      rpcUrl: process.env.POLYGON_RPC_URL!,
    },
    polygonBridgeAddress: process.env.POLYGON_BRIDGE_ADDRESS!,
  },
  thru: {
    signer: {
      baseUrl: process.env.THRU_BASE_URL!,
      feePayerAddress: process.env.THRU_FEE_PAYER_ADDRESS!,
      feePayerPrivateKey: process.env.THRU_FEE_PAYER_PRIVATE_KEY!,
    },
    thruBridgeProgramAddress: process.env.THRU_BRIDGE_PROGRAM_ADDRESS!,
  },
});
```

Config is chain-scoped:

- `polygon.polygonBridgeAddress`: Polygon Bridge contract address.
- `polygon.signer`: Polygon transaction signer and fee payer.
- `thru.thruBridgeProgramAddress`: Thru bridge program address.
- `thru token program`: fixed to `taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKqq`.
- `thru.signer.feePayerAddress`: Thru fee payer/depositor account (`ta...`).
- `thru.signer.feePayerPrivateKey`: Thru Ed25519 private key (32-byte hex).

## Approve + Deposit Example

Approve first:

```ts
const approve = await bridge.approvePolygonToken({
  polygonTokenAddress: '0xYourPolygonTokenAddress',
  rawAmount: 1_000_000n,
});
```

Then deposit:

```ts
const result = await bridge.depositPolygonToThru({
  thruRecipient: 'taXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  polygonTokenAddress: '0xYourPolygonTokenAddress',
  rawAmount: 1_000_000n,
});

console.log(result.polygonTxHash, result.polygonDepositEvent?.sequence.toString());
```

Metadata by token address:

```ts
const metadata = await bridge.getPolygonTokenMetadata('0xYourPolygonTokenAddress');
console.log(metadata.name, metadata.symbol, metadata.decimals);
```

## Thru -> Polygon Example

Check if a Thru mint is actually a Polygon-bridged token:

```ts
const route = await bridge.getThruPolygonTokenRoute('taYourThruTokenMint');
if (!route.isPolygonBridgedToken) {
  throw new Error('mint is not bridged from Polygon');
}
console.log(route.polygonTokenAddress);
```

Deposit back to Polygon:

```ts
const result = await bridge.depositThruToPolygon({
  thruTokenMintAddress: 'taYourThruTokenMint',
  polygonRecipientAddress: '0xYourPolygonRecipient',
  rawAmount: 1_000_000n,
});

console.log(result.thruSignature);
```

## Fixed Chain IDs

- `thru = 1`
- `polygon = 2`

## Available Functions

Top-level exports:

- `createBridgeClient(config)`
- `POLYGON_BRIDGE_ABI`
- `POLYGON_ERC20_ABI`
- `THRU_POLYGON_CHAIN_IDS`
- `THRU_TOKEN_PROGRAM_ADDRESS`

`BridgeClient` methods:

- `getPolygonTokenMetadata(polygonTokenAddress)`
- `approvePolygonToken({ polygonTokenAddress, rawAmount })`
- `depositPolygonToThru({ thruRecipient, polygonTokenAddress, rawAmount })`
- `getPolygonDepositFromTx(txHash)`
- `getThruPolygonTokenRoute(thruTokenMintAddress)`
- `depositThruToPolygon({ thruTokenMintAddress, polygonRecipientAddress, rawAmount, thruTokenAccountAddress?, payloadHex? })`

Recipient address conversion is handled internally by `depositPolygonToThru(...)`.

## Amount Rules

- `rawAmount` is `bigint` only.
- `rawAmount` is validated as `u64` (`0..18446744073709551615`).
- Submitted deposit amount must be `> 0`.

## Allowance Requirement

- `depositPolygonToThru(...)` checks ERC20 allowance and throws if insufficient.
- Call `approvePolygonToken(...)` before deposit (or approve externally).
