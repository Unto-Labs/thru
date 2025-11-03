#ifndef HEADER_tn_sdk_txn_h
#define HEADER_tn_sdk_txn_h

#include "tn_sdk_base.h"
#include "tn_sdk_types.h"

/* Universal transaction header - minimal header present in all transaction
 * versions */
struct tsdk_txn_hdr_universal {
  tn_signature_t fee_payer_signature;
  uchar transaction_version;
};
typedef struct tsdk_txn_hdr_universal tsdk_txn_hdr_universal_t;

/* ThruNet v1 transaction header */
struct tsdk_txn_hdr_v1 {
  tn_signature_t
      fee_payer_signature; /* bytes: [0,64) - Fee payer's signature */
  uchar
      transaction_version; /* bytes: [64,65) - Transaction version (always 1) */
  uchar flags;             /* bytes: [65,66) - Transaction flags */
  ushort readwrite_accounts_cnt; /* bytes: [66,68) - Number of read-write
                                    accounts */
  ushort
      readonly_accounts_cnt; /* bytes: [68,70) - Number of read-only accounts */
  ushort instr_data_sz;      /* bytes: [70,72) - Size of instruction data */
  uint req_compute_units;    /* bytes: [72,76) - Requested compute units */
  ushort req_state_units;    /* bytes: [76,78) - Requested state units */
  ushort req_memory_units;   /* bytes: [78,80) - Requested memory units */
  ulong fee;         /* bytes: [80,88) - Transaction fee in native tokens */
  ulong nonce;       /* bytes: [88,96) - Transaction nonce */
  ulong start_slot;  /* bytes: [96,104) - Slot when transaction becomes valid */
  uint expiry_after; /* bytes: [104,108) - Slots after start_slot when
                        transaction expires */
  uint padding_0;    /* bytes: [108,112) - Reserved padding */
  tn_pubkey_t fee_payer_pubkey; /* bytes: [112,144) - Fee payer's public key */
  tn_pubkey_t
      program_pubkey; /* bytes: [144,176) - Target program's public key */
};
typedef struct tsdk_txn_hdr_v1 tsdk_txn_hdr_v1_t;
#define TSDK_TXN_HDR_V1_SZ (sizeof(tsdk_txn_hdr_v1_t))

/* Transaction header union - allows access to different transaction versions */
union tsdk_txn_hdr {
  tsdk_txn_hdr_universal_t version;
  tsdk_txn_hdr_v1_t v1;
};
typedef union tsdk_txn_hdr tsdk_txn_hdr_t;

/* ThruNet transaction structure - contains header and variable-length account
 * list */
struct tsdk_txn {
  tsdk_txn_hdr_t hdr; /* Transaction header */
  tn_pubkey_t
      input_pubkeys[]; /* Variable-length array of account public keys */
};
typedef struct tsdk_txn tsdk_txn_t;

#define TSDK_SHADOW_STACK_FRAME_MAX (16U)

/* Account metadata structure containing account state information */
struct __attribute__((packed)) tsdk_account_meta {
  uchar version;       /* bytes: [0,1) - Account metadata version */
  uchar flags;         /* bytes: [1,2) - Account flags */
  uint data_sz;        /* bytes: [2,6) - Size of account data */
  ulong seq;           /* bytes: [6,14) - Account sequence number */
  tn_pubkey_t owner;   /* bytes: [14,46) - Account owner public key */
  ulong balance;       /* bytes: [46,54) - Account balance in native tokens */
  ulong nonce;         /* bytes: [54,62) - Account nonce */
};
typedef struct tsdk_account_meta tsdk_account_meta_t;
#define TSDK_ACCOUNT_META_FOOTPRINT (sizeof(tsdk_account_meta_t))

/* Shadow stack frame for tracking program invocation context */
struct tsdk_shadow_stack_frame {
  ushort program_acc_idx; /* Index of the program account */
};
typedef struct tsdk_shadow_stack_frame tsdk_shadow_stack_frame_t;

/* Shadow stack for managing cross-program invocation state */
struct tsdk_shadow_stack {
  ushort call_depth; /* Current call depth */
  ushort
      current_program_acc_idx; /* Currently executing program account index */
  tsdk_shadow_stack_frame_t
      stack_frames[TSDK_SHADOW_STACK_FRAME_MAX]; /* Stack frames */
};
typedef struct tsdk_shadow_stack tsdk_shadow_stack_t;

/* Block context structure containing current block information */
struct tsdk_block_ctx {
  ulong slot;                 /* Current block slot number */
  ulong block_time;           /* Block timestamp (Unix epoch in nanoseconds) */
  ulong global_state_counter; /* Global state counter */
  tn_hash_t parent_blockhash; /* Hash of the parent block */
  tn_pubkey_t block_producer; /* Public key of the block producer */
  tn_hash_t state_root;       /* Merkle root of the state tree */
};
typedef struct tsdk_block_ctx tsdk_block_ctx_t;

struct __attribute__((packed)) tsdk_state_proof_hdr {
  ulong type_slot; /* high bit is the proof type, low 62 bits are slot */
  tn_hash_t path_bitset;
};
typedef struct tsdk_state_proof_hdr tsdk_state_proof_hdr_t;
#define TN_STATE_PROOF_KEYS_MAX (256UL)

struct __attribute__((packed)) tsdk_state_proof {
  tsdk_state_proof_hdr_t hdr;

  union {
    tn_hash_t proof_keys[TN_STATE_PROOF_KEYS_MAX + 2UL];
    struct {
      tn_pubkey_t existing_leaf_pubkey;
      tn_hash_t existing_leaf_hash;
      tn_hash_t sibling_hashes[TN_STATE_PROOF_KEYS_MAX];
    } creation;
    struct {
      tn_hash_t sibling_hashes[TN_STATE_PROOF_KEYS_MAX];
    } existing;

    struct {
      tn_hash_t existing_leaf_hash;
      tn_hash_t sibling_hashes[TN_STATE_PROOF_KEYS_MAX];
    } updating;
  } proof_body;
};
typedef struct tsdk_state_proof tsdk_state_proof_t;

static inline ulong
tsdk_state_proof_header_type(tsdk_state_proof_hdr_t const * hdr) {
  return hdr->type_slot >> 62; // type is 2 upper bits of type_slot
}

static inline ulong
tsdk_state_proof_header_slot(tsdk_state_proof_hdr_t const * hdr) {
  return hdr->type_slot & ((1UL << 62) - 1); // lower 62 bits of type_slot
}

static inline ulong
tsdk_state_proof_footprint_from_header(tsdk_state_proof_hdr_t const * hdr) {
  int sibling_hash_cnt = __builtin_popcountll(hdr->path_bitset.ul[0]) +
                         __builtin_popcountll(hdr->path_bitset.ul[1]) +
                         __builtin_popcountll(hdr->path_bitset.ul[2]) +
                         __builtin_popcountll(hdr->path_bitset.ul[3]);

  ulong type = tsdk_state_proof_header_type(hdr);
  ulong body_sz = (type + (ulong)sibling_hash_cnt) * sizeof(tn_hash_t);

  return sizeof(tsdk_state_proof_hdr_t) + body_sz;
}

/* Utility functions matching main transaction header API */
static inline tn_signature_t const *
tsdk_txn_get_fee_payer_signature(tsdk_txn_t const * txn) {
  return &txn->hdr.v1.fee_payer_signature;
}

static inline tn_pubkey_t const * tsdk_txn_get_acct_addrs(tsdk_txn_t const * txn) {
  return &txn->hdr.v1.fee_payer_pubkey;
}

static inline uchar const * tsdk_txn_get_instr_data(tsdk_txn_t const * txn) {
  return (uchar const *)((ulong)txn + sizeof(tsdk_txn_hdr_v1_t) +
                         sizeof(tn_pubkey_t) *
                            (txn->hdr.v1.readwrite_accounts_cnt +
                             txn->hdr.v1.readonly_accounts_cnt));
}

static inline ushort tsdk_txn_get_instr_data_sz(tsdk_txn_t const* txn) {
  return txn->hdr.v1.instr_data_sz;
}

static inline ulong tsdk_txn_get_fee(tsdk_txn_t const* txn) {
  return txn->hdr.v1.fee;
}

static inline ulong tsdk_txn_get_start_slot(tsdk_txn_t const* txn) {
  return txn->hdr.v1.start_slot;
}

static inline ulong tsdk_txn_get_expiry_slot(tsdk_txn_t const* txn) {
  return txn->hdr.v1.start_slot + txn->hdr.v1.expiry_after;
}

static inline ulong tsdk_txn_get_nonce(tsdk_txn_t const* txn) {
  return txn->hdr.v1.nonce;
}

static inline ulong tsdk_txn_get_requested_compute_units(tsdk_txn_t const* txn) {
  return txn->hdr.v1.req_compute_units;
}

static inline ulong tsdk_txn_get_requested_memory_units(tsdk_txn_t const* txn) {
  return txn->hdr.v1.req_memory_units;
}

static inline int tsdk_txn_has_fee_payer_state_proof(tsdk_txn_t const* txn) {
  return (txn->hdr.v1.flags & (1U << TN_TXN_FLAG_HAS_FEE_PAYER_PROOF)) != 0;
}

static inline ulong tsdk_txn_readwrite_account_cnt(tsdk_txn_t const* txn) {
  return txn->hdr.v1.readwrite_accounts_cnt;
}

static inline ulong tsdk_txn_readonly_account_cnt(tsdk_txn_t const* txn) {
  return txn->hdr.v1.readonly_accounts_cnt;
}

static inline ushort tsdk_txn_account_cnt(tsdk_txn_t const* txn) {
  return (ushort)(2U + txn->hdr.v1.readonly_accounts_cnt +
                  txn->hdr.v1.readwrite_accounts_cnt);
}

static inline int tsdk_txn_is_account_idx_writable(tsdk_txn_t const* txn,
                                                 ushort acc_idx) {
  return (acc_idx == 0U) ||
         ((acc_idx >= 2U) &&
          (acc_idx < (2 + txn->hdr.v1.readwrite_accounts_cnt)));
}

#endif /* HEADER_tn_sdk_txn_h */
