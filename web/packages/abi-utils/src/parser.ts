import type { AbiAccountHeader, AbiAccountData, AbiAccountState } from "./types";
import { ABI_STATE } from "./types";

/**
 * Size of the ABI account header in bytes:
 * - 32 bytes: program_meta_acc (pubkey)
 * - 8 bytes: revision (u64)
 * - 1 byte: state (u8)
 * - 4 bytes: content_sz (u32)
 * Total: 45 bytes
 */
export const ABI_ACCOUNT_HEADER_SIZE = 32 + 8 + 1 + 4;

/**
 * Parses the header from ABI account data.
 *
 * @param data - Raw account data bytes
 * @returns Parsed header
 * @throws If data is too small for the header
 */
export function parseAbiAccountHeader(data: Uint8Array): AbiAccountHeader {
  if (data.length < ABI_ACCOUNT_HEADER_SIZE) {
    throw new Error(
      `ABI account data too small: ${data.length} bytes, expected at least ${ABI_ACCOUNT_HEADER_SIZE}`
    );
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // program_meta_acc: bytes 0-31 (32 bytes)
  const programMetaAccount = data.slice(0, 32);

  // revision: bytes 32-39 (8 bytes, little-endian u64)
  const revision = view.getBigUint64(32, true);

  // state: byte 40 (1 byte)
  const stateRaw = data[40];
  const state: AbiAccountState = stateRaw === ABI_STATE.FINALIZED
    ? ABI_STATE.FINALIZED
    : ABI_STATE.OPEN;

  // content_sz: bytes 41-44 (4 bytes, little-endian u32)
  const contentSize = view.getUint32(41, true);

  return {
    programMetaAccount,
    revision,
    state,
    contentSize,
  };
}

/**
 * Parses the full ABI account data including content.
 *
 * @param data - Raw account data bytes
 * @returns Parsed header and content
 * @throws If data is too small or content size exceeds available data
 */
export function parseAbiAccountData(data: Uint8Array): AbiAccountData {
  const header = parseAbiAccountHeader(data);

  const expectedSize = ABI_ACCOUNT_HEADER_SIZE + header.contentSize;
  if (data.length < expectedSize) {
    throw new Error(
      `ABI account data incomplete: ${data.length} bytes, expected ${expectedSize} (header + ${header.contentSize} content bytes)`
    );
  }

  const contentBytes = data.slice(ABI_ACCOUNT_HEADER_SIZE, ABI_ACCOUNT_HEADER_SIZE + header.contentSize);
  const content = new TextDecoder().decode(contentBytes);

  return {
    ...header,
    contentBytes,
    content,
  };
}
