#ifndef HEADER_sdks_cpp_types_tn_types_hpp
#define HEADER_sdks_cpp_types_tn_types_hpp

#include <array>

// Basic type definitions for compatibility
using uchar = unsigned char;
using ushort = unsigned short;
using uint = unsigned int;
using ulong = unsigned long;

// Cryptographic types - matching original C packing
union __attribute__((packed)) pubkey_t {
  std::array<uchar, 32> key;
  std::array<uchar, 32> hash;

  // Generic type specific accessors (matching original)
  std::array<ulong, 4> ul;  // 32 / sizeof(ulong) = 4
  std::array<uint, 8> ui;   // 32 / sizeof(uint) = 8
  std::array<uchar, 32> uc; // 32 bytes
};

union signature_t {
  std::array<uchar, 64> uc;
  std::array<ulong, 8> ul; // 64 / sizeof(ulong) = 8
};

using ed25519_sig_t = signature_t;

/* ThruNet v1 transaction header.
 * Transaction wire format:
 *   [header (112 bytes)]
 *   [input_pubkeys (variable)]
 *   [instr_data (variable)]
 *   [state_proof (optional)]
 *   [account_meta (optional)]
 *   [fee_payer_signature (64 bytes)] */
struct tn_txn_hdr_v1 {
  uchar transaction_version;       /* bytes: [0,1) - Transaction version (always 1) */
  uchar flags;                     /* bytes: [1,2) - Transaction flags */
  ushort readwrite_accounts_cnt;   /* bytes: [2,4) - Number of read-write accounts */
  ushort readonly_accounts_cnt;    /* bytes: [4,6) - Number of read-only accounts */
  ushort instr_data_sz;            /* bytes: [6,8) - Size of instruction data */
  uint req_compute_units;          /* bytes: [8,12) - Requested compute units */
  ushort req_state_units;          /* bytes: [12,14) - Requested state units */
  ushort req_memory_units;         /* bytes: [14,16) - Requested memory units */
  ulong fee;                       /* bytes: [16,24) - Transaction fee in native tokens */
  ulong nonce;                     /* bytes: [24,32) - Transaction nonce */
  ulong start_slot;                /* bytes: [32,40) - Slot when transaction becomes valid */
  uint expiry_after;               /* bytes: [40,44) - Slots after start_slot when transaction expires */
  ushort chain_id;                 /* bytes: [44,46) - Chain identifier (must be non-zero) */
  ushort padding_0;                /* bytes: [46,48) - Reserved padding */
  pubkey_t fee_payer_pubkey;       /* bytes: [48,80) - Fee payer's public key */
  pubkey_t program_pubkey;         /* bytes: [80,112) - Target program's public key */
};

/* Universal transaction header - minimal header present in all transaction versions */
struct tn_txn_hdr_universal {
  uchar transaction_version;       /* bytes: [0,1) - Transaction version */
};

union tn_txn_hdr {
  tn_txn_hdr_universal version;
  tn_txn_hdr_v1 v1;
};

// Transaction structure
struct tn_txn {
  tn_txn_hdr hdr;
  // Variable-length array of pubkeys follows
  // pubkey_t input_pubkeys[];
};

// Account metadata structure - matching original packed attribute
struct __attribute__((packed)) tn_account_meta {
  uchar version;       /* bytes: [0,1) */
  uchar flags;         /* bytes: [1,2) */
  uint data_sz;        /* bytes: [2,6) */
  ulong seq;           /* bytes: [6,14) - Account sequence number */
  pubkey_t owner;      /* bytes: [14,46) */
  ulong balance;       /* bytes: [46,54) */
  ulong nonce;         /* bytes: [54,62) */
};

// Account metadata constants
constexpr ulong TN_ACCOUNT_META_FOOTPRINT = sizeof(tn_account_meta);

// Transaction constants (defined early as they are used in inline functions)
constexpr ulong TN_TXN_SIGNATURE_SZ = 64UL;
constexpr ulong TN_TXN_PUBKEY_SZ = 32UL;
constexpr ulong TN_TXN_ACCT_ADDR_SZ = 32UL;
constexpr ulong TN_TXN_BLOCKHASH_SZ = 32UL;

// Transaction inline functions (C++ compatible)

/* tn_txn_get_fee_payer_signature: Returns a pointer to the fee payer signature.
   The signature is at the END of the transaction (last 64 bytes). */
inline const ed25519_sig_t* tn_txn_get_fee_payer_signature(const tn_txn* txn, ulong txn_sz) {
  return (const ed25519_sig_t*)((const uchar*)txn + txn_sz - TN_TXN_SIGNATURE_SZ);
}

/* tn_txn_get_msg: Returns the message portion of the transaction
   (everything except the trailing signature). */
inline const uchar* tn_txn_get_msg(const tn_txn* txn) {
  return (const uchar*)txn;
}

/* tn_txn_get_msg_sz: Returns the size of the message portion
   (total transaction size minus signature). */
inline ulong tn_txn_get_msg_sz(ulong txn_sz) {
  return txn_sz - TN_TXN_SIGNATURE_SZ;
}

inline const pubkey_t* tn_txn_get_acct_addrs(const tn_txn* txn) {
  return &txn->hdr.v1.fee_payer_pubkey;
}

inline const uchar* tn_txn_get_instr_data(const tn_txn* txn) {
  return (const uchar*)txn + sizeof(tn_txn_hdr_v1) +
         (txn->hdr.v1.readwrite_accounts_cnt +
          txn->hdr.v1.readonly_accounts_cnt) *
             sizeof(pubkey_t);
}

inline ushort tn_txn_get_instr_data_sz(const tn_txn* txn) {
  return txn->hdr.v1.instr_data_sz;
}

inline ulong tn_txn_get_fee(const tn_txn* txn) { return txn->hdr.v1.fee; }

inline ulong tn_txn_get_start_slot(const tn_txn* txn) {
  return txn->hdr.v1.start_slot;
}

inline ulong tn_txn_get_expiry_slot(const tn_txn* txn) {
  return txn->hdr.v1.start_slot + txn->hdr.v1.expiry_after;
}

inline ulong tn_txn_get_nonce(const tn_txn* txn) { return txn->hdr.v1.nonce; }

inline ushort tn_txn_get_chain_id(const tn_txn* txn) { return txn->hdr.v1.chain_id; }

inline ulong tn_txn_get_requested_compute_units(const tn_txn* txn) {
  return txn->hdr.v1.req_compute_units;
}

inline ulong tn_txn_get_requested_memory_units(const tn_txn* txn) {
  return txn->hdr.v1.req_memory_units;
}

inline ushort tn_txn_readwrite_account_cnt(const tn_txn* txn) {
  return txn->hdr.v1.readwrite_accounts_cnt;
}

inline ushort tn_txn_readonly_account_cnt(const tn_txn* txn) {
  return txn->hdr.v1.readonly_accounts_cnt;
}

inline ushort tn_txn_account_cnt(const tn_txn* txn) {
  return static_cast<ushort>(2U + txn->hdr.v1.readwrite_accounts_cnt +
                             txn->hdr.v1.readonly_accounts_cnt);
}

inline bool tn_txn_is_account_idx_writable(const tn_txn* txn, ushort acc_idx) {
  return (acc_idx == 0U) ||
         ((acc_idx >= 2U) &&
          (acc_idx < (2 + txn->hdr.v1.readwrite_accounts_cnt)));
}

// Transaction flags
constexpr uint TN_TXN_FLAG_HAS_FEE_PAYER_PROOF = 0U;

constexpr uchar TN_TXN_V1 = 0x01;

constexpr int TSDK_REG_MAX = 32;

struct tsdk_shadow_stack_frame {
  ushort program_acc_idx;
  ushort stack_pages;
  ushort heap_pages;
  ulong  saved_regs[TSDK_REG_MAX]; /* Saved registers at invoke time for cross-frame access */
};

constexpr int TSDK_SHADOW_STACK_FRAME_MAX = 17;

struct tsdk_shadow_stack {
  ushort call_depth;
  ushort current_total_stack_pages;
  ushort current_total_heap_pages;
  ushort max_call_depth;
  tsdk_shadow_stack_frame stack_frames[TSDK_SHADOW_STACK_FRAME_MAX];
};

// Account metadata structure for SDK compatibility (using same packing)
constexpr ulong TSDK_ACCOUNT_META_FOOTPRINT = TN_ACCOUNT_META_FOOTPRINT;

// Block context structure containing current block information
struct __attribute__((packed)) tn_block_ctx {
  ulong slot;                 // Current block slot number
  ulong block_time;           // Block timestamp (Unix epoch in nanoseconds)
  ulong block_price;          // Block price
  pubkey_t block_producer;    // Public key of the block producer
  pubkey_t state_root;        // Merkle root of the state tree
  pubkey_t cur_block_hash;    // Current block hash
};

// Block context constants

#endif /* HEADER_sdks_cpp_types_tn_types_hpp */
