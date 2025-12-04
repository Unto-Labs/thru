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

// Transaction header structure (no explicit packing, but contains packed
// members)
struct tn_txn_hdr_v1 {
  signature_t fee_payer_signature; /* bytes: [0,64) */
  uchar transaction_version;       /* bytes: [64,65) */
  uchar flags;                     /* bytes: [65,66) */
  ushort readwrite_accounts_cnt;   /* bytes: [66,68) */
  ushort readonly_accounts_cnt;    /* bytes: [68,70) */
  ushort instr_data_sz;            /* bytes: [70,72) */
  uint req_compute_units;          /* bytes: [72,76) */
  ushort req_state_units;          /* bytes: [76,78) */
  ushort req_memory_units;         /* bytes: [78,80) */
  ulong fee;                       /* bytes: [80,88) */
  ulong nonce;                     /* bytes: [88,96) */
  ulong start_slot;                /* bytes: [96,104) */
  uint expiry_after;               /* bytes: [104,108) */
  uint padding_0;                  /* bytes: [108,112) */
  pubkey_t fee_payer_pubkey;       /* bytes: [112,144) */
  pubkey_t program_pubkey;         /* bytes: [144,176) */
};

struct tn_txn_hdr_universal {
  signature_t fee_payer_signature;
  uchar transaction_version;
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

// Transaction inline functions (C++ compatible)
inline const ed25519_sig_t* tn_txn_get_fee_payer_signature(const tn_txn* txn) {
  return &txn->hdr.v1.fee_payer_signature;
}

inline const pubkey_t* tn_txn_get_acct_addrs(const tn_txn* txn) {
  return &txn->hdr.v1.fee_payer_pubkey;
}

inline const uchar* tn_txn_get_instr_data(const tn_txn* txn) {
  return reinterpret_cast<const uchar*>(txn) + sizeof(tn_txn_hdr_v1) +
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

// Transaction constants
constexpr ulong TN_TXN_SIGNATURE_SZ = 64UL;
constexpr ulong TN_TXN_PUBKEY_SZ = 32UL;
constexpr ulong TN_TXN_ACCT_ADDR_SZ = 32UL;
constexpr ulong TN_TXN_BLOCKHASH_SZ = 32UL;

// Transaction flags
constexpr uint TN_TXN_FLAG_HAS_FEE_PAYER_PROOF = 0U;

constexpr uchar TN_TXN_V1 = 0x01;

struct tsdk_shadow_stack_frame {
  ushort program_acc_idx;
};

constexpr int TSDK_SHADOW_STACK_FRAME_MAX = 16;

struct tsdk_shadow_stack {
  ushort call_depth;
  ushort current_program_acc_idx;
  tsdk_shadow_stack_frame stack_frames[16];
};

// Account metadata structure for SDK compatibility (using same packing)
constexpr ulong TSDK_ACCOUNT_META_FOOTPRINT = TN_ACCOUNT_META_FOOTPRINT;

// Block context structure containing current block information
struct __attribute__((packed)) tn_block_ctx {
  ulong slot;                 // Current block slot number
  ulong block_time;           // Block timestamp (Unix epoch in nanoseconds)
  ulong block_price;          // Block price
  pubkey_t parent_blockhash;  // Hash of the parent block
  pubkey_t block_producer;    // Public key of the block producer
  pubkey_t state_root;        // Merkle root of the state tree
  pubkey_t cur_block_hash;    // Current block hash (truncated)
};

// Block context constants

#endif /* HEADER_sdks_cpp_types_tn_types_hpp */
