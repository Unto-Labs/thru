/**
 * Named constants of the Thru Ledger APDU protocol
 * (`specs/ledger/app-thru-apdu.md` §2.2). Hosts MUST NOT inline these literals.
 */

/** APDU class byte for every Thru app command. */
export const THRU_CLA = 0xe0;

/** Name the device app reports through the OS `GET_APP_AND_VERSION` (`B0 01`). */
export const THRU_APP_NAME = 'Thru';

/**
 * SLIP-44 coin type used in Thru derivation paths.
 *
 * Keep it in lock-step with `ThruHDWallet.THRU_COIN_TYPE` in `@thru/sdk` and
 * with the device app's `ledger_app.toml` path restriction.
 */
export const THRU_COIN_TYPE = 8478;

/** BIP-44 purpose. */
export const THRU_PURPOSE = 44;

/** Hardened-derivation bit of a BIP-32 path component. */
export const HARDENED = 0x80000000;

/** Largest data field of a short APDU. Extended-length APDUs are not supported. */
export const APDU_MAX_DATA = 255;

/**
 * Largest chunk index (P1 is one byte and never wraps, §3.4). A stream may
 * have at most this many data chunks after chunk 0.
 */
export const CHUNK_INDEX_MAX = 255;

/**
 * Smallest chunk size the public planners accept. The device accepts 1..255
 * (§3.4), but small chunks make a stream need more than
 * {@link CHUNK_INDEX_MAX} data chunks, and P1 would wrap to 0 and start a new
 * device session mid-stream. The planners also reject any stream that needs
 * more than {@link CHUNK_INDEX_MAX} chunks at the chosen size (at 128 that is
 * any stream over 32640 bytes). Hosts SHOULD send 255.
 */
export const CHUNK_SIZE_MIN = 128;

/** Size of the fixed transaction header (`TN_TXN_HDR_V1_SZ`). */
export const TXN_HDR_SZ = 112;

/** Transaction MTU, including the 64-byte signature (`TN_TXN_MTU`). */
export const TXN_MTU = 32768;

/** Ed25519 signature size. */
export const SIGNATURE_SZ = 64;

/** Ed25519 public key size. */
export const PUBKEY_SZ = 32;

/** Largest transaction body (`TXN_MTU - 64`). */
export const TXN_BODY_MAX = TXN_MTU - SIGNATURE_SZ;

/** Account limit: fee payer + program + read-write + read-only (`TN_TXN_MAX_ACCOUNTS`). */
export const TXN_MAX_ACCOUNTS = 1024;

/** `sizeof(tn_state_proof_hdr_t)`. */
export const STATE_PROOF_HDR_SZ = 40;

/** `sizeof(tn_account_meta_t)`. */
export const ACCOUNT_META_SZ = 64;

/** Largest off-chain message (`TN_SIGNATURE_CTX_MAX`). */
export const MSG_MAX = 32768;

/** Printable-ASCII messages up to this length are shown in full (D12). */
export const MSG_DISPLAY_MAX = 512;

/** Device RAM bound for the read-write/read-only disjointness check (§7.5.3). */
export const RW_CACHE_MAX = 32;

/**
 * Read-only keys the device keeps to resolve the mint of a checked token
 * transfer (§7.5.3, §7.7). A mint further back is a blind-signing review.
 */
export const RO_CACHE_MAX = 4;

/** Ticker field size of a checked token transfer (§7.7). */
export const TICKER_MAX = 8;

/** Most decimals the device shows for a checked token transfer (§7.7, B.7). */
export const TOKEN_DECIMALS_MAX = 19;

/**
 * Fee above which the device shows a "High fee" warning, in base units.
 *
 * 0.1 THRU, confirmed in plan decision D13.
 */
export const FEE_WARN_THRESHOLD = 100_000_000n;

/** APDU protocol version this host implements (GET_APP_CONFIG byte 4). */
export const APDU_PROTOCOL_VERSION = 1;

/** Native THRU decimals. */
export const THRU_DECIMALS = 9;

/** Instruction bytes (§3.3). */
export const Ins = {
  GET_VERSION: 0x03,
  GET_APP_NAME: 0x04,
  GET_APP_CONFIG: 0x05,
  GET_PUBKEY: 0x06,
  SIGN_TXN: 0x07,
  SIGN_MESSAGE: 0x08,
  SIGN_EOA_AUTH: 0x09,
} as const;

export type Ins = (typeof Ins)[keyof typeof Ins];

/** P2 values for chunked commands (§3.4). */
export const P2_MORE = 0x80;
export const P2_LAST = 0x00;

/** GET_PUBKEY P1 values (§6.4). */
export const P1_SILENT = 0x00;
export const P1_DISPLAY = 0x01;

/** Transaction header flag bits. */
export const TXN_FLAG_HAS_FEE_PAYER_PROOF = 0x01;
export const TXN_FLAG_MAY_COMPRESS_ACCOUNT = 0x02;

/** Fee-payer state-proof types (bits 62..63 of `type_slot`). */
export const STATE_PROOF_TYPE_EXISTING = 0;
export const STATE_PROOF_TYPE_UPDATING = 1;
export const STATE_PROOF_TYPE_CREATION = 2;

/** SIGN_EOA_AUTH `kind` byte (§9.1). */
export const EoaAuthKind = {
  CREATE: 0,
  DELETE: 1,
} as const;

export type EoaAuthKind = (typeof EoaAuthKind)[keyof typeof EoaAuthKind];

/** 16-byte ASCII domain-separation tags (§2.3). */
export const DST_TXN = 'tn_txn_sign_v1__';
export const DST_MSG = 'tn_msg_sign_v1__';
export const DST_EOA_CREATE = 'tn_eoa_create_v1';
export const DST_EOA_DELETE = 'tn_eoa_delete_v1';
