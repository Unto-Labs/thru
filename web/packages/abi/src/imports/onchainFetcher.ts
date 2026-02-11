/**
 * On-chain ABI Fetcher
 *
 * Fetches ABI content from on-chain accounts.
 */

import type { AbiAccountData, RpcEndpoints, RevisionSpec, OnchainTarget } from "./types";
import {
  ABI_ACCOUNT_HEADER_SIZE,
  ABI_STATE_OPEN,
  ABI_STATE_FINALIZED,
  DEFAULT_RPC_ENDPOINTS,
} from "./types";

/**
 * Minimal interface for a Thru RPC client that can fetch raw accounts.
 * This is compatible with @thru/thru-sdk client but doesn't require it.
 */
export interface ThruRpcClient {
  query: {
    getRawAccount: (request: {
      address: { value: Uint8Array };
      versionContext: Record<string, unknown>;
    }) => Promise<{ rawData?: Uint8Array }>;
  };
}

/* ABI account seed suffix (matches on-chain ABI manager) */
const ABI_ACCOUNT_SUFFIX = "_abi_account";
const ABI_ACCOUNT_SUFFIX_BYTES = new TextEncoder().encode(ABI_ACCOUNT_SUFFIX);

const ABI_META_HEADER_SIZE = 4;
const ABI_META_BODY_SIZE = 96;
const ABI_META_ACCOUNT_SIZE = ABI_META_HEADER_SIZE + ABI_META_BODY_SIZE;

const ABI_META_VERSION = 1;
const ABI_META_KIND_OFFICIAL = 0;
const ABI_META_KIND_EXTERNAL = 1;

const DEFAULT_ABI_MANAGER_PROGRAM_ID =
  "taWqAAOSe9pavaaMpkc9VbSLBUMbuW6Mk59sZlSbcNHsJA";

async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return new Uint8Array(hashBuffer);
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function abiMetaBodyForProgram(program: Uint8Array): Uint8Array {
  const body = new Uint8Array(ABI_META_BODY_SIZE);
  body.set(program.slice(0, 32), 0);
  return body;
}

async function deriveAbiAccountSeed(kind: number, body: Uint8Array): Promise<Uint8Array> {
  return sha256Bytes(concatBytes(new Uint8Array([kind]), body, ABI_ACCOUNT_SUFFIX_BYTES));
}

async function createProgramDefinedAccountAddress(
  owner: Uint8Array,
  isEphemeral: boolean,
  seed: Uint8Array
): Promise<Uint8Array> {
  const flag = new Uint8Array([isEphemeral ? 1 : 0]);
  return sha256Bytes(concatBytes(owner, flag, seed));
}

async function deriveAbiAccountAddress(
  kind: number,
  body: Uint8Array,
  owner: Uint8Array,
  isEphemeral: boolean
): Promise<Uint8Array> {
  const seed = await deriveAbiAccountSeed(kind, body);
  return createProgramDefinedAccountAddress(owner, isEphemeral, seed);
}

/**
 * Derive the official ABI account address for a given program.
 *
 * This performs the same derivation as OnchainFetcher.fetch() with target="program",
 * returning the raw 32-byte address of the ABI account.
 */
export async function deriveOfficialAbiAddress(
  programAddress: string,
  abiManagerProgramId: string = DEFAULT_ABI_MANAGER_PROGRAM_ID
): Promise<Uint8Array> {
  const programBytes = decodeAddress(programAddress);
  const managerBytes = decodeAddress(abiManagerProgramId);
  const body = abiMetaBodyForProgram(programBytes);
  return deriveAbiAccountAddress(ABI_META_KIND_OFFICIAL, body, managerBytes, false);
}

type AbiMetaAccount = {
  version: number;
  kind: number;
  flags: number;
  body: Uint8Array;
};

function parseAbiMetaAccount(data: Uint8Array): AbiMetaAccount {
  if (data.length < ABI_META_ACCOUNT_SIZE) {
    throw new Error(
      `ABI meta account data too short: ${data.length} bytes, expected at least ${ABI_META_ACCOUNT_SIZE}`
    );
  }

  const version = data[0];
  const kind = data[1];
  const flags = data[2] | (data[3] << 8);
  const body = data.slice(ABI_META_HEADER_SIZE, ABI_META_HEADER_SIZE + ABI_META_BODY_SIZE);

  if (version !== ABI_META_VERSION) {
    throw new Error(`Unsupported ABI meta version: ${version}`);
  }
  if (kind !== ABI_META_KIND_OFFICIAL && kind !== ABI_META_KIND_EXTERNAL) {
    throw new Error(`Unsupported ABI meta kind: ${kind}`);
  }

  return { version, kind, flags, body };
}

/**
 * Parse ABI account data from raw bytes.
 *
 * Account header layout (45 bytes):
 * - abi_meta_account: [u8; 32]
 * - revision: u64 (little-endian)
 * - state: u8 (0x00=OPEN, 0x01=FINALIZED)
 * - content_sz: u32 (little-endian)
 * - content: [u8; content_sz]
 */
export function parseAbiAccountData(data: Uint8Array): AbiAccountData {
  if (data.length < ABI_ACCOUNT_HEADER_SIZE) {
    throw new Error(
      `ABI account data too short: ${data.length} bytes, expected at least ${ABI_ACCOUNT_HEADER_SIZE}`
    );
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const abiMetaAccount = data.slice(0, 32);
  const revision = view.getBigUint64(32, true);
  const state = data[40];
  const contentSize = view.getUint32(41, true);

  if (state !== ABI_STATE_OPEN && state !== ABI_STATE_FINALIZED) {
    throw new Error(`Invalid ABI account state: ${state}`);
  }

  const expectedSize = ABI_ACCOUNT_HEADER_SIZE + contentSize;
  if (data.length < expectedSize) {
    throw new Error(
      `ABI account data truncated: ${data.length} bytes, expected ${expectedSize}`
    );
  }

  const contentBytes = data.slice(ABI_ACCOUNT_HEADER_SIZE, expectedSize);
  const content = new TextDecoder().decode(contentBytes);

  return {
    abiMetaAccount,
    revision,
    state,
    content,
  };
}

/**
 * Check if a revision matches the specification.
 */
export function revisionMatches(revision: bigint, spec: RevisionSpec): boolean {
  switch (spec.type) {
    case "latest":
      return true;
    case "exact":
      return revision === BigInt(spec.value);
    case "minimum":
      return revision >= BigInt(spec.value);
    default:
      return false;
  }
}

export interface OnchainFetcherConfig {
  rpcEndpoints?: RpcEndpoints;
  thruClient?: ThruRpcClient;
  abiManagerProgramId?: string;
  abiManagerIsEphemeral?: boolean;
}

export interface FetchResult {
  abiYaml: string;
  revision: bigint;
  isFinalized: boolean;
}

/**
 * Fetcher for on-chain ABI accounts.
 *
 * Supports fetching ABI from:
 * - Official ABI via program (target: "program")
 * - ABI via ABI meta account (target: "abi-meta")
 * - Direct ABI account (target: "abi")
 */
export class OnchainFetcher {
  private rpcEndpoints: RpcEndpoints;
  private thruClient?: ThruRpcClient;
  private abiManagerProgramId: Uint8Array;
  private abiManagerIsEphemeral: boolean;

  constructor(config: OnchainFetcherConfig = {}) {
    this.rpcEndpoints = { ...DEFAULT_RPC_ENDPOINTS, ...config.rpcEndpoints };
    this.thruClient = config.thruClient;
    const managerId = config.abiManagerProgramId ?? DEFAULT_ABI_MANAGER_PROGRAM_ID;
    this.abiManagerProgramId = decodeAddress(managerId);
    this.abiManagerIsEphemeral = config.abiManagerIsEphemeral ?? false;
  }

  /**
   * Fetch ABI content from an on-chain account.
   */
  async fetch(
    address: string,
    target: OnchainTarget,
    network: string,
    revision: RevisionSpec
  ): Promise<FetchResult> {
    const addressBytes = this.parseAddress(address);
    let abiAddress: Uint8Array;
    if (target === "program") {
      const body = abiMetaBodyForProgram(addressBytes);
      abiAddress = await deriveAbiAccountAddress(
        ABI_META_KIND_OFFICIAL,
        body,
        this.abiManagerProgramId,
        this.abiManagerIsEphemeral
      );
    } else if (target === "abi-meta") {
      const metaData = await this.fetchAccountData(addressBytes, network);
      const meta = parseAbiMetaAccount(metaData);
      abiAddress = await deriveAbiAccountAddress(
        meta.kind,
        meta.body,
        this.abiManagerProgramId,
        this.abiManagerIsEphemeral
      );
    } else {
      abiAddress = addressBytes;
    }

    const accountData = await this.fetchAccountData(abiAddress, network);
    const parsed = parseAbiAccountData(accountData);

    if (!revisionMatches(parsed.revision, revision)) {
      const revisionStr =
        revision.type === "exact"
          ? `exactly ${revision.value}`
          : revision.type === "minimum"
            ? `at least ${revision.value}`
            : "latest";
      throw new Error(
        `ABI revision mismatch: got ${parsed.revision}, expected ${revisionStr}`
      );
    }

    return {
      abiYaml: parsed.content,
      revision: parsed.revision,
      isFinalized: parsed.state === ABI_STATE_FINALIZED,
    };
  }

  /**
   * Get the RPC endpoint for a network.
   */
  getRpcEndpoint(network: string): string {
    const endpoint = this.rpcEndpoints[network];
    if (!endpoint) {
      throw new Error(
        `Unknown network: ${network}. Configure rpcEndpoints for this network.`
      );
    }
    return endpoint;
  }

  private parseAddress(address: string): Uint8Array {
    return decodeAddress(address);
  }

  private async fetchAccountData(address: Uint8Array, network: string): Promise<Uint8Array> {
    if (this.thruClient) {
      return this.fetchWithThruClient(address);
    }
    return this.fetchWithHttp(address, network);
  }

  private async fetchWithThruClient(address: Uint8Array): Promise<Uint8Array> {
    if (!this.thruClient) {
      throw new Error("ThruClient not configured");
    }

    const response = await this.thruClient.query.getRawAccount({
      address: { value: address },
      versionContext: {},
    });

    if (!response.rawData) {
      throw new Error("Account not found or has no data");
    }

    return response.rawData;
  }

  private async fetchWithHttp(address: Uint8Array, network: string): Promise<Uint8Array> {
    const endpoint = this.getRpcEndpoint(network);
    const addressStr = encodeThruAddress(address);

    /* Use HTTP/JSON-RPC fallback */
    const response = await fetch(`${endpoint}/v1/accounts/${addressStr}:raw`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`ABI account not found: ${addressStr}`);
      }
      throw new Error(`Failed to fetch account: ${response.status} ${response.statusText}`);
    }

    const json = await response.json();
    if (!json.rawData) {
      throw new Error("Account has no data");
    }

    /* rawData is base64 encoded */
    return base64Decode(json.rawData);
  }
}

const BASE64_URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function decodeAddress(address: string): Uint8Array {
  if (address.startsWith("ta") && address.length === 46) {
    return decodeThruAddress(address);
  }
  throw new Error(`Invalid Thru address format: ${address} (expected 46-char ta-prefixed address)`);
}

function decodeThruAddress(address: string): Uint8Array {
  if (address.length !== 46 || !address.startsWith("ta")) {
    throw new Error(`Invalid Thru address: ${address}`);
  }

  const invlut = new Int16Array(256);
  invlut.fill(-1);
  for (let i = 0; i < BASE64_URL_ALPHABET.length; i += 1) {
    invlut[BASE64_URL_ALPHABET.charCodeAt(i)] = i;
  }

  let inIdx = 2;
  let inSz = 40;
  let outIdx = 0;
  let checksum = 0;
  const out = new Uint8Array(32);

  while (inSz >= 4) {
    const a = invlut[address.charCodeAt(inIdx + 0)];
    const b = invlut[address.charCodeAt(inIdx + 1)];
    const c = invlut[address.charCodeAt(inIdx + 2)];
    const d = invlut[address.charCodeAt(inIdx + 3)];
    if (a < 0 || b < 0 || c < 0 || d < 0) {
      throw new Error(`Invalid Thru address character at ${inIdx}`);
    }
    const triple = (a << 18) | (b << 12) | (c << 6) | d;
    const temp1 = (triple >> 16) & 0xff;
    checksum += temp1;
    out[outIdx++] = temp1;
    const temp2 = (triple >> 8) & 0xff;
    checksum += temp2;
    out[outIdx++] = temp2;
    const temp3 = triple & 0xff;
    checksum += temp3;
    out[outIdx++] = temp3;
    inIdx += 4;
    inSz -= 4;
  }

  const a = invlut[address.charCodeAt(inIdx + 0)];
  const b = invlut[address.charCodeAt(inIdx + 1)];
  const c = invlut[address.charCodeAt(inIdx + 2)];
  const d = invlut[address.charCodeAt(inIdx + 3)];
  if (a < 0 || b < 0 || c < 0 || d < 0) {
    throw new Error(`Invalid Thru address character at ${inIdx}`);
  }
  const triple = (a << 18) | (b << 12) | (c << 6) | d;
  const temp1 = (triple >> 16) & 0xff;
  checksum += temp1;
  out[outIdx++] = temp1;
  const temp2 = (triple >> 8) & 0xff;
  checksum += temp2;
  out[outIdx++] = temp2;
  const incomingChecksum = triple & 0xff;
  if ((checksum & 0xff) !== incomingChecksum) {
    throw new Error("Invalid Thru address checksum");
  }

  return out;
}

function encodeThruAddress(bytes: Uint8Array): string {
  if (bytes.length !== 32) {
    throw new Error(`Expected 32 bytes, got ${bytes.length}`);
  }

  function maskForBits(bits: number): number {
    return bits === 0 ? 0 : (1 << bits) - 1;
  }

  let output = "ta";
  let checksum = 0;
  let accumulator = 0;
  let bitsCollected = 0;

  for (let i = 0; i < 30; i++) {
    const byte = bytes[i];
    checksum += byte;
    accumulator = (accumulator << 8) | byte;
    bitsCollected += 8;
    while (bitsCollected >= 6) {
      const index = (accumulator >> (bitsCollected - 6)) & 0x3f;
      output += BASE64_URL_ALPHABET[index];
      bitsCollected -= 6;
      accumulator &= maskForBits(bitsCollected);
    }
  }

  const secondLast = bytes[30];
  checksum += secondLast;
  accumulator = (accumulator << 8) | secondLast;
  bitsCollected += 8;

  const last = bytes[31];
  checksum += last;
  accumulator = (accumulator << 8) | last;
  bitsCollected += 8;

  accumulator = (accumulator << 8) | (checksum & 0xff);
  bitsCollected += 8;

  while (bitsCollected >= 6) {
    const index = (accumulator >> (bitsCollected - 6)) & 0x3f;
    output += BASE64_URL_ALPHABET[index];
    bitsCollected -= 6;
    accumulator &= maskForBits(bitsCollected);
  }

  return output;
}

function base64Decode(str: string): Uint8Array {
  const binaryStr = atob(str);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes;
}
