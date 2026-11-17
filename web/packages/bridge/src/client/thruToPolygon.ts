import { programResources } from '@thru/programs/resources';
import { decodeAddress, encodeAddress } from '@thru/sdk/helpers';
import { StateProofType } from '@thru/sdk/proto';
import { AccountView } from '@thru/sdk';
import { assertU64Amount } from '../amount';
import { THRU_POLYGON_CHAIN_IDS } from '../constants';
import type {
  ThruPolygonTokenRoute,
  ThruToPolygonDepositRequest,
  ThruToPolygonDepositResult,
} from '../types';
import {
  bytes32ToEvmAddress,
  bytesEqual,
  bytesToHex,
  concatBytes,
  evmAddressToBytes32,
  isThruAccountNotFoundError,
  isZeroBytes,
  normalizeHex,
  normalizeThruTransactionWire,
  parseHexPayload,
  readThruTxnHeader,
  readU16LE,
  readU64LE,
  u16LE,
  u32LE,
  u64LE,
  validateAddress,
  validateThruAddress,
} from '../utils';
import { requireThru, type BridgeClientState, type ThruConfigState } from './state';

type ThruMintMetadataRoute = ThruPolygonTokenRoute & {
  destinationTokenBytes: Uint8Array;
};

type ThruDepositInstructionInput = {
  bridgeManagerAddress: string;
  tokenProgramAddress: string;
  tokenAccountAddress: string;
  tokenMintAddress: string;
  metadataAccountAddress: string;
  depositorAddress: string;
  feeTokenAccountAddress: string;
  feeCollectorAddress: string;
  recipientBytes32: Uint8Array;
  amountRaw: bigint;
  feeTokenSeed: Uint8Array;
  payload: Uint8Array;
  feeTokenProof: Uint8Array;
  getAccountIndex: (address: string) => number;
};

type PreparedThruToPolygonDeposit = {
  thruTokenMintAddress: string;
  thruTokenAccountAddress?: string;
  polygonRecipientAddress: string;
  recipientBytes32: Uint8Array;
  rawAmount: bigint;
  payload: Uint8Array;
};

type ResolvedThruToPolygonDeposit = {
  route: ThruMintMetadataRoute;
  bridgeManagerAddress: string;
  feeCollectorAddress: string;
  depositorAddress: string;
  thruTokenAccountAddress: string;
  feeVaultTokenAccountAddress: string;
  feeTokenSeed: Uint8Array;
  feeTokenProof: Uint8Array;
  readWriteAccounts: string[];
  readOnlyAccounts: string[];
};

const BRIDGE_INSTR_DEPOSIT = 2;
const THRU_TXN_MTU = 32768;
const BRIDGE_MAX_PAYLOAD_SIZE = 1024;

/* Account layouts. Byte 0 of every account is its discriminator and the
   payload follows (packed). Must match bridges/smart-contracts/thru/tn_bridge.h
   (bridges/smart-contracts/thru/abi/tn_bridge.abi.yaml) and the token program
   (tn_token_program_types.h). */
const BRIDGE_ACCOUNT_TYPE_BRIDGE_V1 = 2;
const BRIDGE_ACCOUNT_TYPE_MINT_METADATA_V1 = 3;
const TOKEN_ACCOUNT_TYPE_TOKEN_ACCOUNT_V1 = 2;

/* tn_bridge_account_t: account_type(1) + 55-byte header + ring + fee_config(36) + program_config(64) */
const BRIDGE_HEADER_SIZE = 1 + 55;
const BRIDGE_RING_SLOT_COUNT = 256;
const BRIDGE_RING_SLOT_SIZE = 90;
const BRIDGE_FEE_CONFIG_OFFSET = BRIDGE_HEADER_SIZE + BRIDGE_RING_SLOT_COUNT * BRIDGE_RING_SLOT_SIZE;
const BRIDGE_FEE_COLLECTOR_OFFSET = BRIDGE_FEE_CONFIG_OFFSET + 4;
export const BRIDGE_ACCOUNT_SIZE = BRIDGE_FEE_CONFIG_OFFSET + 36 + 64;

/* tn_bridge_mint_metadata_t: account_type(1) + origin_chain_id(2) + origin_token_address(32) */
export const BRIDGE_MINT_METADATA_SIZE = 35;

/* tn_token_account_data_t: account_type(1) + mint(32) + owner(32) + amount(8) + is_frozen(1) */
const THRU_TOKEN_ACCOUNT_MINT_OFFSET = 1;
const THRU_TOKEN_ACCOUNT_OWNER_OFFSET = 33;
const THRU_TOKEN_ACCOUNT_AMOUNT_OFFSET = 65;
export const THRU_TOKEN_ACCOUNT_SIZE = 74;

/** Decodes a bridge mint metadata account; throws unless the size and discriminator match. */
export function parseThruBridgeMintMetadata(data: Uint8Array | undefined): {
  originChainId: number;
  originTokenBytes: Uint8Array;
} {
  if (
    !data ||
    data.length !== BRIDGE_MINT_METADATA_SIZE ||
    data[0] !== BRIDGE_ACCOUNT_TYPE_MINT_METADATA_V1
  ) {
    throw new Error('bridge mint metadata account is missing or malformed');
  }
  return {
    originChainId: readU16LE(data, 1),
    originTokenBytes: data.slice(3, 35),
  };
}

/** Returns the fee collector bytes of a bridge account; throws unless the size and discriminator match. */
export function parseThruBridgeFeeCollector(data: Uint8Array | undefined): Uint8Array {
  if (!data || data.length !== BRIDGE_ACCOUNT_SIZE || data[0] !== BRIDGE_ACCOUNT_TYPE_BRIDGE_V1) {
    throw new Error('bridge manager account data is missing or malformed');
  }
  const feeCollectorBytes = data.slice(BRIDGE_FEE_COLLECTOR_OFFSET, BRIDGE_FEE_COLLECTOR_OFFSET + 32);
  if (isZeroBytes(feeCollectorBytes)) {
    throw new Error('bridge fee collector is not configured');
  }
  return feeCollectorBytes;
}

/** Decodes a token account; throws unless the size and discriminator match. */
export function parseThruTokenAccount(data: Uint8Array | undefined): {
  mintBytes: Uint8Array;
  ownerBytes: Uint8Array;
  amount: bigint;
} {
  if (!data || data.length !== THRU_TOKEN_ACCOUNT_SIZE || data[0] !== TOKEN_ACCOUNT_TYPE_TOKEN_ACCOUNT_V1) {
    throw new Error('token account is missing or malformed');
  }
  return {
    mintBytes: data.slice(THRU_TOKEN_ACCOUNT_MINT_OFFSET, THRU_TOKEN_ACCOUNT_MINT_OFFSET + 32),
    ownerBytes: data.slice(THRU_TOKEN_ACCOUNT_OWNER_OFFSET, THRU_TOKEN_ACCOUNT_OWNER_OFFSET + 32),
    amount: readU64LE(data, THRU_TOKEN_ACCOUNT_AMOUNT_OFFSET),
  };
}

export async function getThruPolygonTokenRoute(
  state: BridgeClientState,
  thruTokenMintAddress: string
): Promise<ThruPolygonTokenRoute> {
  const thru = requireThru(state);
  const tokenMintAddress = validateThruAddress(thruTokenMintAddress, 'thruTokenMintAddress');
  const route = await loadThruMintMetadataRoute(thru, tokenMintAddress);

  return {
    thruTokenMintAddress: route.thruTokenMintAddress,
    thruMetadataAccountAddress: route.thruMetadataAccountAddress,
    destinationChainId: route.destinationChainId,
    polygonTokenAddressBytes32: route.polygonTokenAddressBytes32,
    polygonTokenAddress: route.polygonTokenAddress,
    isPolygonBridgedToken: route.isPolygonBridgedToken,
  };
}

export async function depositThruToPolygon(
  state: BridgeClientState,
  input: ThruToPolygonDepositRequest
): Promise<ThruToPolygonDepositResult> {
  const thru = requireThru(state);
  const prepared = prepareThruToPolygonDeposit(input);
  const resolved = await resolveThruToPolygonDeposit(thru, prepared);
  const signed = await buildAndSignThruToPolygonDeposit(thru, prepared, resolved);

  const thruSignature = await sendThruDepositTransaction(thru, signed.rawTransaction, {
    instructionSize: signed.instructionSize,
    readWriteAccounts: resolved.readWriteAccounts.length,
    readOnlyAccounts: resolved.readOnlyAccounts.length,
  });

  return {
    thruSignature,
    rawAmount: prepared.rawAmount,
    thruTokenMintAddress: prepared.thruTokenMintAddress,
    thruTokenAccountAddress: resolved.thruTokenAccountAddress,
    thruMetadataAccountAddress: resolved.route.thruMetadataAccountAddress,
    bridgeManagerAddress: resolved.bridgeManagerAddress,
    feeCollectorAddress: resolved.feeCollectorAddress,
    feeVaultTokenAccountAddress: resolved.feeVaultTokenAccountAddress,
    polygonTokenAddress: resolved.route.polygonTokenAddress as string,
    polygonRecipientAddress: prepared.polygonRecipientAddress,
    polygonRecipientBytes32: normalizeHex(bytesToHex(prepared.recipientBytes32)),
  };
}

function prepareThruToPolygonDeposit(input: ThruToPolygonDepositRequest): PreparedThruToPolygonDeposit {
  const thruTokenMintAddress = validateThruAddress(input.thruTokenMintAddress, 'thruTokenMintAddress');
  const thruTokenAccountAddress = input.thruTokenAccountAddress
    ? validateThruAddress(input.thruTokenAccountAddress, 'thruTokenAccountAddress')
    : undefined;
  const polygonRecipientAddress = validateAddress(input.polygonRecipientAddress, 'polygonRecipientAddress');
  const rawAmount = assertU64Amount(input.rawAmount, 'rawAmount');
  if (rawAmount === 0n) {
    throw new Error('rawAmount must be > 0');
  }

  const payload = parseHexPayload(input.payloadHex);
  if (payload.length > BRIDGE_MAX_PAYLOAD_SIZE) {
    throw new Error(`payloadHex must be <= ${BRIDGE_MAX_PAYLOAD_SIZE} bytes`);
  }

  return {
    thruTokenMintAddress,
    thruTokenAccountAddress,
    polygonRecipientAddress,
    recipientBytes32: evmAddressToBytes32(polygonRecipientAddress),
    rawAmount,
    payload,
  };
}

async function resolveThruToPolygonDeposit(
  thru: ThruConfigState,
  input: PreparedThruToPolygonDeposit
): Promise<ResolvedThruToPolygonDeposit> {
  const route = await loadThruMintMetadataRoute(thru, input.thruTokenMintAddress);
  if (!route.isPolygonBridgedToken || !route.polygonTokenAddress) {
    throw new Error(
      `thruTokenMintAddress is not a Polygon-bridged token (expected destinationChainId=${THRU_POLYGON_CHAIN_IDS.polygon})`
    );
  }

  const bridgeManagerAddress = deriveThruBridgeManagerAddress(thru, THRU_POLYGON_CHAIN_IDS.polygon);
  const feeCollectorAddress = await readThruFeeCollectorAddress(thru, bridgeManagerAddress);
  const depositorAddress = thru.feePayerAddress;
  const depositorBytes = decodeAddress(depositorAddress);
  const tokenMintBytes = decodeAddress(input.thruTokenMintAddress);

  const bridgedSeed = thru.client.helpers.deriveAddress([route.destinationTokenBytes, u16LE(route.destinationChainId)]).bytes;
  const depositorTokenSeed = thru.client.helpers.deriveAddress([depositorBytes, bridgedSeed]).bytes;
  const thruTokenAccountAddress = input.thruTokenAccountAddress
    ? input.thruTokenAccountAddress
    : deriveThruTokenAccountAddress(thru, depositorAddress, input.thruTokenMintAddress, depositorTokenSeed);

  await assertThruTokenAccountBalance(
    thru,
    thruTokenAccountAddress,
    tokenMintBytes,
    depositorBytes,
    input.rawAmount
  );

  const feeCollectorBytes = decodeAddress(feeCollectorAddress);
  const feeTokenSeed = thru.client.helpers.deriveAddress([feeCollectorBytes, bridgedSeed]).bytes;
  const feeVaultTokenAccountAddress = deriveThruTokenAccountAddress(
    thru,
    feeCollectorAddress,
    input.thruTokenMintAddress,
    feeTokenSeed
  );
  const feeTokenProof = await getThruCreatingProofIfMissing(thru, feeVaultTokenAccountAddress);

  const accountLists = buildThruToPolygonDepositAccountLists({
    bridgeManagerAddress,
    thruTokenAccountAddress,
    thruTokenMintAddress: input.thruTokenMintAddress,
    feeVaultTokenAccountAddress,
    tokenProgramAddress: thru.tokenProgramAddress,
    metadataAccountAddress: route.thruMetadataAccountAddress,
    feeCollectorAddress,
    depositorAddress,
  });

  return {
    route,
    bridgeManagerAddress,
    feeCollectorAddress,
    depositorAddress,
    thruTokenAccountAddress,
    feeVaultTokenAccountAddress,
    feeTokenSeed,
    feeTokenProof,
    readWriteAccounts: accountLists.readWriteAccounts,
    readOnlyAccounts: accountLists.readOnlyAccounts,
  };
}

function buildThruToPolygonDepositAccountLists(input: {
  bridgeManagerAddress: string;
  thruTokenAccountAddress: string;
  thruTokenMintAddress: string;
  feeVaultTokenAccountAddress: string;
  tokenProgramAddress: string;
  metadataAccountAddress: string;
  feeCollectorAddress: string;
  depositorAddress: string;
}): { readWriteAccounts: string[]; readOnlyAccounts: string[] } {
  const readWriteAccounts = [
    input.bridgeManagerAddress,
    input.thruTokenAccountAddress,
    input.thruTokenMintAddress,
    input.feeVaultTokenAccountAddress,
  ];

  const readOnlyAccounts = [input.tokenProgramAddress, input.metadataAccountAddress];
  if (input.feeCollectorAddress !== input.depositorAddress && !readWriteAccounts.includes(input.feeCollectorAddress)) {
    readOnlyAccounts.push(input.feeCollectorAddress);
  }

  return { readWriteAccounts, readOnlyAccounts };
}

async function buildAndSignThruToPolygonDeposit(
  thru: ThruConfigState,
  input: PreparedThruToPolygonDeposit,
  resolved: ResolvedThruToPolygonDeposit
): Promise<{ rawTransaction: Uint8Array; instructionSize: number }> {
  let instructionSize = 0;
  const signed = await thru.client.transactions.buildAndSign({
    feePayer: {
      publicKey: thru.feePayerAddress,
      privateKey: thru.feePayerPrivateKey,
    },
    program: thru.bridgeProgramAddress,
    header: {
      ...programResources({ stateUnits: 1 }),
      chainId: THRU_POLYGON_CHAIN_IDS.thru,
    },
    accounts: {
      readWrite: resolved.readWriteAccounts,
      readOnly: resolved.readOnlyAccounts,
    },
    instructionData: async (context: { getAccountIndex: (address: string) => number }) => {
      const instruction = buildThruDepositInstruction({
        bridgeManagerAddress: resolved.bridgeManagerAddress,
        tokenProgramAddress: thru.tokenProgramAddress,
        tokenAccountAddress: resolved.thruTokenAccountAddress,
        tokenMintAddress: input.thruTokenMintAddress,
        metadataAccountAddress: resolved.route.thruMetadataAccountAddress,
        depositorAddress: resolved.depositorAddress,
        feeTokenAccountAddress: resolved.feeVaultTokenAccountAddress,
        feeCollectorAddress: resolved.feeCollectorAddress,
        recipientBytes32: input.recipientBytes32,
        amountRaw: input.rawAmount,
        feeTokenSeed: resolved.feeTokenSeed,
        payload: input.payload,
        feeTokenProof: resolved.feeTokenProof,
        getAccountIndex: context.getAccountIndex,
      });
      instructionSize = instruction.length;
      return instruction;
    },
  });

  return { rawTransaction: signed.rawTransaction, instructionSize };
}

async function sendThruDepositTransaction(
  thru: ThruConfigState,
  rawTransaction: Uint8Array,
  diagnostics: {
    instructionSize: number;
    readWriteAccounts: number;
    readOnlyAccounts: number;
  }
): Promise<string> {
  const { normalizedRawTransaction, legacySignaturePrefixed } = normalizeThruTransactionWire(rawTransaction);
  const rawHeader = readThruTxnHeader(normalizedRawTransaction);

  if (normalizedRawTransaction.length > THRU_TXN_MTU) {
    throw new Error(
      `transaction too large: rawTxBytes=${normalizedRawTransaction.length} exceeds Thru MTU=${THRU_TXN_MTU}. ` +
        `Try pre-creating the fee vault token account so no fee-token creating proof is attached.`
    );
  }

  try {
    return await thru.client.transactions.send(normalizedRawTransaction);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/parse failed/i.test(message)) {
      throw new Error(
        `transaction rejected: Parse failed (rawTxBytes=${normalizedRawTransaction.length}, ` +
          `instructionBytes=${diagnostics.instructionSize}, readWriteAccounts=${diagnostics.readWriteAccounts}, ` +
          `readOnlyAccounts=${diagnostics.readOnlyAccounts}, chainId=${THRU_POLYGON_CHAIN_IDS.thru}, ` +
          `header.version=${rawHeader.version}, header.flags=${rawHeader.flags}, ` +
          `header.rw=${rawHeader.readWriteAccounts}, header.ro=${rawHeader.readOnlyAccounts}, ` +
          `header.instr=${rawHeader.instructionDataSize}, header.chainId=${rawHeader.chainId}, ` +
          `legacySignaturePrefixed=${legacySignaturePrefixed})`
      );
    }
    throw error;
  }
}

async function loadThruMintMetadataRoute(
  thru: ThruConfigState,
  thruTokenMintAddress: string
): Promise<ThruMintMetadataRoute> {
  const tokenMintBytes = decodeAddress(thruTokenMintAddress);
  const metadata = thru.client.helpers.deriveProgramAddress({
    programAddress: thru.bridgeProgramAddress,
    seed: tokenMintBytes,
    ephemeral: false,
  });

  const metadataAccount = await thru.client.accounts.get(metadata.address, {
    view: AccountView.DATA_ONLY,
  });

  const { originChainId: destinationChainId, originTokenBytes: destinationTokenBytes } =
    parseThruBridgeMintMetadata(metadataAccount.data?.data);
  const polygonTokenAddress = bytes32ToEvmAddress(destinationTokenBytes);
  const polygonTokenAddressBytes32 = normalizeHex(bytesToHex(destinationTokenBytes));

  return {
    thruTokenMintAddress,
    thruMetadataAccountAddress: metadata.address,
    destinationChainId,
    polygonTokenAddressBytes32,
    polygonTokenAddress,
    isPolygonBridgedToken: destinationChainId === THRU_POLYGON_CHAIN_IDS.polygon,
    destinationTokenBytes,
  };
}

function deriveThruBridgeManagerAddress(thru: ThruConfigState, chainId: number): string {
  return thru.client.helpers.deriveProgramAddress({
    programAddress: thru.bridgeProgramAddress,
    seed: `bridge_manager_${chainId}`,
    ephemeral: false,
  }).address;
}

async function readThruFeeCollectorAddress(thru: ThruConfigState, bridgeManagerAddress: string): Promise<string> {
  const bridgeAccount = await thru.client.accounts.get(bridgeManagerAddress, {
    view: AccountView.DATA_ONLY,
  });

  return encodeAddress(parseThruBridgeFeeCollector(bridgeAccount.data?.data));
}

function deriveThruTokenAccountAddress(
  thru: ThruConfigState,
  ownerAddress: string,
  mintAddress: string,
  seed: Uint8Array
): string {
  if (seed.length !== 32) {
    throw new Error('token account seed must be 32 bytes');
  }

  const ownerBytes = decodeAddress(ownerAddress);
  const mintBytes = decodeAddress(mintAddress);
  const derivedSeed = thru.client.helpers.deriveAddress([ownerBytes, mintBytes, seed]).bytes;

  return thru.client.helpers.deriveProgramAddress({
    programAddress: thru.tokenProgramAddress,
    seed: derivedSeed,
    ephemeral: false,
  }).address;
}

async function assertThruTokenAccountBalance(
  thru: ThruConfigState,
  tokenAccountAddress: string,
  expectedMintBytes: Uint8Array,
  expectedOwnerBytes: Uint8Array,
  requiredAmount: bigint
): Promise<void> {
  const account = await thru.client.accounts.get(tokenAccountAddress, {
    view: AccountView.DATA_ONLY,
  });

  const { mintBytes, ownerBytes, amount } = parseThruTokenAccount(account.data?.data);

  if (!bytesEqual(mintBytes, expectedMintBytes)) {
    throw new Error('token account mint does not match thruTokenMintAddress');
  }
  if (!bytesEqual(ownerBytes, expectedOwnerBytes)) {
    throw new Error('token account owner does not match the configured Thru fee payer');
  }
  if (amount < requiredAmount) {
    throw new Error(`insufficient Thru token balance: have ${amount.toString()}, need ${requiredAmount.toString()}`);
  }
}

async function getThruCreatingProofIfMissing(thru: ThruConfigState, address: string): Promise<Uint8Array> {
  try {
    await thru.client.accounts.get(address, { view: AccountView.PUBKEY_ONLY });
    return new Uint8Array();
  } catch (error) {
    if (!isThruAccountNotFoundError(error)) {
      throw error;
    }

    const proof = await thru.client.proofs.generate({
      address,
      proofType: StateProofType.CREATING,
    });
    return proof.proof;
  }
}

function buildThruDepositInstruction(input: ThruDepositInstructionInput): Uint8Array {
  const bridgeAccountIdx = input.getAccountIndex(input.bridgeManagerAddress);
  const tokenProgramIdx = input.getAccountIndex(input.tokenProgramAddress);
  const tokenAccountIdx = input.getAccountIndex(input.tokenAccountAddress);
  const tokenMintIdx = input.getAccountIndex(input.tokenMintAddress);
  const metadataIdx = input.getAccountIndex(input.metadataAccountAddress);
  const depositorIdx = input.getAccountIndex(input.depositorAddress);
  const feeTokenAccountIdx = input.getAccountIndex(input.feeTokenAccountAddress);
  const feeCollectorIdx = input.getAccountIndex(input.feeCollectorAddress);

  if (input.payload.length > 0xffff) {
    throw new Error('payload too large for bridge deposit instruction');
  }
  if (input.feeTokenProof.length > 0xffff) {
    throw new Error('fee token state proof too large for bridge deposit instruction');
  }
  if (input.feeTokenSeed.length !== 32) {
    throw new Error('fee token account seed must be 32 bytes');
  }

  const instructionHead = concatBytes(
    u32LE(BRIDGE_INSTR_DEPOSIT),
    u16LE(bridgeAccountIdx),
    u16LE(THRU_POLYGON_CHAIN_IDS.polygon),
    u16LE(tokenProgramIdx),
    u16LE(tokenAccountIdx),
    u16LE(tokenMintIdx),
    u16LE(metadataIdx),
    u16LE(depositorIdx),
    u16LE(feeTokenAccountIdx),
    u16LE(feeCollectorIdx),
    decodeAddress(input.tokenMintAddress),
    decodeAddress(input.depositorAddress),
    input.recipientBytes32,
    u64LE(input.amountRaw),
    input.feeTokenSeed,
    u16LE(input.feeTokenProof.length),
    u16LE(input.payload.length)
  );

  return concatBytes(instructionHead, input.payload, input.feeTokenProof);
}
