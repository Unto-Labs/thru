import { create } from "@bufbuild/protobuf";
import { encodeAddress, encodeSignature } from "@thru/helpers";
import { vi } from "vitest";
import type { ThruClientContext } from "../../core/client";
import type { Account, AccountFlags, AccountMeta } from "@thru/proto";
import { AccountFlagsSchema, AccountMetaSchema, AccountSchema } from "@thru/proto";
import type { Block, BlockHeader } from "@thru/proto";
import { BlockHeaderSchema, BlockSchema } from "@thru/proto";
import type { GetHeightResponse, GetChainInfoResponse, ListBlocksResponse } from "@thru/proto";
import { GetHeightResponseSchema, GetChainInfoResponseSchema, ListBlocksResponseSchema } from "@thru/proto";

/**
 * Creates a mock ThruClientContext with mock gRPC clients.
 * Use vi.fn() for methods you want to track or customize.
 */
export function createMockContext(overrides: Partial<ThruClientContext> = {}): ThruClientContext {
  return {
    baseUrl: "https://test.thruput.org",
    transport: {} as any,
    query: {
      getHeight: vi.fn(),
      getAccount: vi.fn(),
      getRawAccount: vi.fn(),
      getTransaction: vi.fn(),
      getRawTransaction: vi.fn(),
      getTransactionStatus: vi.fn(),
      getBlock: vi.fn(),
      getRawBlock: vi.fn(),
      listBlocks: vi.fn(),
      listAccounts: vi.fn(),
      listTransactionsForAccount: vi.fn(),
      getEvent: vi.fn(),
      generateStateProof: vi.fn(),
      getVersion: vi.fn(),
      getChainInfo: vi.fn().mockResolvedValue({ chainId: 1 }),
      ...overrides.query,
    } as any,
    command: {
      sendTransaction: vi.fn(),
      batchSendTransactions: vi.fn(),
      ...overrides.command,
    } as any,
    streaming: {
      trackTransaction: vi.fn(),
      streamBlocks: vi.fn(),
      streamAccountUpdates: vi.fn(),
      streamTransactions: vi.fn(),
      streamEvents: vi.fn(),
      ...overrides.streaming,
    } as any,
    callOptions: overrides.callOptions,
    ...overrides,
  };
}

/**
 * Generates a test Ed25519 public key (32 bytes)
 */
export function generateTestPubkey(value: number = 0x42): Uint8Array {
  const key = new Uint8Array(32);
  key.fill(value & 0xff);
  return key;
}

/**
 * Generates a test Ed25519 signature (64 bytes)
 */
export function generateTestSignature(value: number = 0x42): Uint8Array {
  const sig = new Uint8Array(64);
  sig.fill(value & 0xff);
  return sig;
}

/**
 * Generates a test address string (ta- prefixed)
 */
export function generateTestAddress(value: number = 0x42): string {
  return encodeAddress(generateTestPubkey(value));
}

/**
 * Generates a test signature string (ts- prefixed)
 */
export function generateTestSignatureString(value: number = 0x42): string {
  return encodeSignature(generateTestSignature(value));
}

/**
 * Creates a mock Account protobuf message
 */
export function createMockAccount(overrides: {
  address?: { value: Uint8Array };
  meta?: Partial<AccountMeta>;
  data?: any;
} = {}): Account {
  const address = overrides.address?.value ?? generateTestPubkey();
  
  // If meta is provided as partial, merge with defaults
  const meta = overrides.meta
    ? create(AccountMetaSchema, { ...createMockAccountMeta(), ...overrides.meta } as any)
    : createMockAccountMeta();
  
  return create(AccountSchema, {
    address: {
      value: address,
    },
    meta,
    data: overrides.data,
  });
}

/**
 * Creates a mock AccountMeta protobuf message
 */
export function createMockAccountMeta(overrides: {
  version?: number;
  flags?: AccountFlags;
  dataSize?: number;
  seq?: bigint;
  owner?: { value: Uint8Array };
  balance?: bigint;
  nonce?: bigint;
} = {}): AccountMeta {
  return create(AccountMetaSchema, {
    version: overrides.version ?? 1,
    flags: overrides.flags ?? createMockAccountFlags(),
    dataSize: overrides.dataSize ?? 0,
    seq: overrides.seq ?? 0n,
    owner: overrides.owner ?? { value: generateTestPubkey(0x01) },
    balance: overrides.balance ?? 1000n,
    nonce: overrides.nonce ?? 5n,
  });
}

/**
 * Creates a mock AccountFlags protobuf message
 */
export function createMockAccountFlags(overrides: {
  isProgram?: boolean;
  isPrivileged?: boolean;
  isUncompressable?: boolean;
  isEphemeral?: boolean;
  isDeleted?: boolean;
  isNew?: boolean;
  isCompressed?: boolean;
} = {}): AccountFlags {
  return create(AccountFlagsSchema, {
    isProgram: overrides.isProgram ?? false,
    isPrivileged: overrides.isPrivileged ?? false,
    isUncompressable: overrides.isUncompressable ?? false,
    isEphemeral: overrides.isEphemeral ?? false,
    isDeleted: overrides.isDeleted ?? false,
    isNew: overrides.isNew ?? false,
    isCompressed: overrides.isCompressed ?? false,
  });
}

/**
 * Creates a mock GetHeightResponse protobuf message
 */
export function createMockHeightResponse(overrides: Partial<GetHeightResponse> = {}): GetHeightResponse {
  return create(GetHeightResponseSchema, {
    finalized: 1000n,
    locallyExecuted: 1001n,
    clusterExecuted: 1002n,
    ...overrides,
  });
}

/**
 * Creates a mock GetChainInfoResponse protobuf message
 */
export function createMockChainInfoResponse(overrides: Partial<GetChainInfoResponse> = {}): GetChainInfoResponse {
  return create(GetChainInfoResponseSchema, {
    chainId: 1,
    ...overrides,
  });
}

/**
 * Creates a mock Block protobuf message
 * @param overrides - Partial block overrides. If header is provided as a partial object, it will be merged with defaults.
 */
export function createMockBlock(overrides: Omit<Partial<Block>, "header"> & { header?: Partial<BlockHeader> } = {}): Block {
  // Extract header overrides if provided (as partial object)
  const headerOverrides = overrides.header;
  const { header: _, ...restOverrides } = overrides;
  
  // Create default header
  const defaultHeader: Partial<BlockHeader> = {
    slot: 1000n,
    version: 1,
    startSlot: 999n,
    expiryAfter: 100,
    maxBlockSize: 1024,
    maxComputeUnits: 1000000n,
    maxStateUnits: 10000,
    bondAmountLockUp: 1n,
  };
  
  // Merge header overrides if provided and create protobuf message
  const header = headerOverrides
    ? create(BlockHeaderSchema, { ...defaultHeader, ...headerOverrides } as any)
    : create(BlockHeaderSchema, defaultHeader as any);
  
  return create(BlockSchema, {
    header,
    ...restOverrides,
  });
}

/**
 * Creates a mock ListBlocksResponse protobuf message
 */
export function createMockListBlocksResponse(overrides: Partial<ListBlocksResponse> = {}): ListBlocksResponse {
  return create(ListBlocksResponseSchema, {
    blocks: [],
    ...overrides,
  });
}

/**
 * Creates a mock keypair for testing
 */
export function generateTestKeyPair(): {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  address: string;
} {
  const publicKey = generateTestPubkey();
  const privateKey = new Uint8Array(64);
  privateKey.fill(0x42);
  
  return {
    publicKey,
    privateKey,
    address: encodeAddress(publicKey),
  };
}
