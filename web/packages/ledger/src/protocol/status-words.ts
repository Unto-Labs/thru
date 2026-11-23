/**
 * Status words of the Thru device app (`specs/ledger/app-thru-apdu.md` §5,
 * Appendix C) and the Ledger OS codes hosts must recognize (§5.2).
 */
export const StatusWord = {
  OK: 0x9000,
  WRONG_DATA_LENGTH: 0x6700,
  USER_DENIED: 0x6985,
  WRONG_P1P2: 0x6a86,
  INS_NOT_SUPPORTED: 0x6d00,
  CLA_NOT_SUPPORTED: 0x6e00,
  INTERNAL_ERROR: 0x6f00,

  TXN_INVALID_FORMAT: 0x6801,
  TXN_INVALID_VERSION: 0x6802,
  TXN_INVALID_FLAGS: 0x6803,
  CHAIN_ID_ZERO: 0x6804,
  TXN_INVALID_PROOF_TYPE: 0x6805,
  TXN_ACCOUNT_LIMIT: 0x6806,
  TXN_DUPLICATE_ACCOUNT: 0x6807,
  BLIND_SIGNING_DISABLED: 0x6808,
  TXN_UNSORTED_RW: 0x6809,
  TXN_UNSORTED_RO: 0x680a,

  FEE_PAYER_MISMATCH: 0x6810,
  TXN_PAD_NONZERO: 0x6811,
  TXN_RW_CACHE_EXCEEDED: 0x6812,

  TXN_HINT_INVALID: 0x6813,
  TOKEN_HINT_MISMATCH: 0x6814,

  PATH_REJECTED: 0x6820,

  CHUNK_OUT_OF_ORDER: 0x6830,
  LENGTH_MISMATCH: 0x6831,

  MSG_INVALID_LENGTH: 0x6840,
  MSG_PASS_MISMATCH: 0x6841,

  EOA_ACCOUNT_MISMATCH: 0x6850,
  EOA_INVALID_KIND: 0x6851,

  /* Ledger OS / dashboard (§5.2). */
  OS_DEVICE_LOCKED: 0x5515,
  OS_APP_NOT_OPEN_6E01: 0x6e01,
  OS_APP_NOT_OPEN_6511: 0x6511,
  OS_APP_NOT_OPEN_6D02: 0x6d02,

  /* Ledger Rust SDK, answered without reaching the app (§5.2). */
  SDK_CMD_NOT_ACCEPTED: 0x6901,
  SDK_BAD_LEN: 0x6e03,
} as const;

export type StatusWord = (typeof StatusWord)[keyof typeof StatusWord];

const NAMES: ReadonlyMap<number, string> = new Map(
  Object.entries(StatusWord).map(([name, sw]) => [sw, name] as const),
);

/** Spec name of a status word, or `UNKNOWN_0xXXXX`. */
export function statusWordName(sw: number): string {
  return NAMES.get(sw) ?? `UNKNOWN_0x${formatStatusWord(sw)}`;
}

/** Four uppercase hex digits, no prefix. */
export function formatStatusWord(sw: number): string {
  return (sw & 0xffff).toString(16).toUpperCase().padStart(4, '0');
}

/** Decode a two-byte status word. */
export function statusWordFromBytes(statusCode: Uint8Array): number {
  if (statusCode.length !== 2) {
    throw new Error(`status word must be 2 bytes, got ${statusCode.length}`);
  }
  return (statusCode[0] << 8) | statusCode[1];
}
