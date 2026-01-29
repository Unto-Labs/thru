/**
 * Wire format constants for Thru Network protocol.
 * 
 * These constants define the sizes and formats used in the binary wire protocol
 * for blocks and transactions. They match the Go implementation in
 * grpc/pkg/uds/message/block.go and grpc/pkg/crypto/transaction.go
 */

// ============================================================================
// Common Constants
// ============================================================================

/** Size of an Ed25519 signature in bytes */
export const SIGNATURE_SIZE = 64;

/** Size of a public key/account address in bytes */
export const PUBKEY_SIZE = 32;

/** Size of a hash in bytes */
export const HASH_SIZE = 32;

// ============================================================================
// Block Constants
// ============================================================================

/** Size of a block header in bytes */
export const BLOCK_HEADER_SIZE = 168;

/** Size of a block footer in bytes */
export const BLOCK_FOOTER_SIZE = 104;

/** Block version 1 */
export const BLOCK_VERSION_V1 = 0x01;

// ============================================================================
// Transaction Constants
// ============================================================================

/** Size of a transaction header in bytes (signature is at END, not in header) */
export const TXN_HEADER_SIZE = 112;

/** Transaction version 1 */
export const TXN_VERSION_V1 = 0x01;

/** Maximum number of accounts allowed in a transaction */
export const TXN_MAX_ACCOUNTS = 1024;

/** Size of state proof header in bytes */
export const STATE_PROOF_HEADER_SIZE = 40;

/** Size of account metadata footprint in bytes */
export const ACCOUNT_META_FOOTPRINT = 64;

// ============================================================================
// Transaction Flags
// ============================================================================

/** Flag indicating transaction has fee payer state proof */
export const TXN_FLAG_HAS_FEE_PAYER_PROOF = 1 << 0;

/** Flag indicating account may be compressed */
export const TXN_FLAG_MAY_COMPRESS_ACCOUNT = 1 << 1;

// ============================================================================
// State Proof Types
// ============================================================================

/** State proof type: existing account */
export const STATE_PROOF_TYPE_EXISTING = 0;

/** State proof type: updating account */
export const STATE_PROOF_TYPE_UPDATING = 1;

/** State proof type: creating account */
export const STATE_PROOF_TYPE_CREATION = 2;


