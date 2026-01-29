#ifndef HEADER_tn_sdk_txn_h
#define HEADER_tn_sdk_txn_h

#include "tn_sdk_base.h"
#include "tn_sdk_types.h"

/* Universal transaction header - minimal header present in all transaction
 * versions */
struct tsdk_txn_hdr_universal {
  uchar transaction_version; /* bytes: [0,1) - Transaction version */
};
typedef struct tsdk_txn_hdr_universal tsdk_txn_hdr_universal_t;

/* ThruNet v1 transaction header.
 * Transaction wire format:
 *   [header (112 bytes)]
 *   [input_pubkeys (variable)]
 *   [instr_data (variable)]
 *   [state_proof (optional)]
 *   [account_meta (optional)]
 *   [fee_payer_signature (64 bytes)] */
struct tsdk_txn_hdr_v1 {
  uchar
              transaction_version; /* bytes: [0,1) - Transaction version (always 1) */
  uchar       flags;       /* bytes: [1,2) - Transaction flags */
  ushort      readwrite_accounts_cnt; /* bytes: [2,4) - Number of read-write
                                    accounts */
  ushort
              readonly_accounts_cnt; /* bytes: [4,6) - Number of read-only accounts */
  ushort      instr_data_sz; /* bytes: [6,8) - Size of instruction data */
  uint        req_compute_units; /* bytes: [8,12) - Requested compute units */
  ushort      req_state_units; /* bytes: [12,14) - Requested state units */
  ushort      req_memory_units; /* bytes: [14,16) - Requested memory units */
  ulong       fee;   /* bytes: [16,24) - Transaction fee in native tokens */
  ulong       nonce; /* bytes: [24,32) - Transaction nonce */
  ulong       start_slot; /* bytes: [32,40) - Slot when transaction becomes valid */
  uint        expiry_after; /* bytes: [40,44) - Slots after start_slot when
                        transaction expires */
  ushort      chain_id; /* bytes: [44,46) - Chain identifier (must be non-zero) */
  ushort      padding_0; /* bytes: [46,48) - Reserved padding */
  tn_pubkey_t fee_payer_pubkey; /* bytes: [48,80) - Fee payer's public key */
  tn_pubkey_t
              program_pubkey; /* bytes: [80,112) - Target program's public key */
};
typedef struct tsdk_txn_hdr_v1 tsdk_txn_hdr_v1_t;
#define TSDK_TXN_HDR_V1_SZ (sizeof(tsdk_txn_hdr_v1_t))

/* Transaction header union - allows access to different transaction versions */
union tsdk_txn_hdr {
  tsdk_txn_hdr_universal_t version;
  tsdk_txn_hdr_v1_t        v1;
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

#define TSDK_SHADOW_STACK_FRAME_MAX (17U) /* 16 call depths (1..16) + 1 for frame -1 */

/* Account metadata structure containing account state information */
struct __attribute__(( packed )) tsdk_account_meta {
  uchar       version; /* bytes: [0,1) - Account metadata version */
  uchar       flags;   /* bytes: [1,2) - Account flags */
  uint        data_sz; /* bytes: [2,6) - Size of account data */
  ulong       seq;     /* bytes: [6,14) - Account sequence number */
  tn_pubkey_t owner;   /* bytes: [14,46) - Account owner public key */
  ulong       balance; /* bytes: [46,54) - Account balance in native tokens */
  ulong       nonce;   /* bytes: [54,62) - Account nonce */
};
typedef struct tsdk_account_meta tsdk_account_meta_t;
#define TSDK_ACCOUNT_META_FOOTPRINT (sizeof(tsdk_account_meta_t))

/* Shadow stack frame for tracking program invocation context */
#define TSDK_REG_MAX (32UL)
struct tsdk_shadow_stack_frame {
  ushort program_acc_idx; /* Index of the program account */
  ushort stack_pages;     /* Total size of stack region in pages */
  ushort heap_pages;      /* Total size of heap region in pages */
  ulong  saved_regs[ TSDK_REG_MAX ]; /* Saved registers at invoke time for cross-frame access */
};
typedef struct tsdk_shadow_stack_frame tsdk_shadow_stack_frame_t;

/* Shadow stack for managing cross-program invocation state */
struct tsdk_shadow_stack {
  ushort call_depth;                 /* Current call depth */
  ushort current_total_stack_pages;  /* Total stack pages across all call depths */
  ushort current_total_heap_pages;   /* Total heap pages across all call depths */
  ushort max_call_depth;             /* Maximum call depth reached */
  /* Frame array: stack_frames[0] is frame -1 (all zeros), stack_frames[1] is call depth 1 (root), etc. */
  tsdk_shadow_stack_frame_t
         stack_frames[TSDK_SHADOW_STACK_FRAME_MAX]; /* Stack frames */
};
typedef struct tsdk_shadow_stack tsdk_shadow_stack_t;

/* Block context structure containing current block information */
struct tsdk_block_ctx {
  ulong       slot;           /* Current block slot number */
  ulong       block_time;     /* Block timestamp (Unix epoch in nanoseconds) */
  ulong       block_price;    /* Block price */
  tn_hash_t   state_root;     /* Merkle root of the state tree */
  tn_hash_t   cur_block_hash; /* Current block hash */
  tn_pubkey_t block_producer; /* Public key of the block producer */
};
typedef struct tsdk_block_ctx tsdk_block_ctx_t;

struct __attribute__(( packed )) tsdk_state_proof_hdr {
  ulong     type_slot; /* high bit is the proof type, low 62 bits are slot */
  tn_hash_t path_bitset;
};
typedef struct tsdk_state_proof_hdr tsdk_state_proof_hdr_t;
#define TN_STATE_PROOF_KEYS_MAX (256UL)

struct __attribute__(( packed )) tsdk_state_proof {
  tsdk_state_proof_hdr_t hdr;

  union {
    tn_hash_t proof_keys[TN_STATE_PROOF_KEYS_MAX + 2UL];
    struct {
      tn_pubkey_t existing_leaf_pubkey;
      tn_hash_t   existing_leaf_hash;
      tn_hash_t   sibling_hashes[TN_STATE_PROOF_KEYS_MAX];
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
tsdk_state_proof_header_type( tsdk_state_proof_hdr_t const * hdr ) {
  return hdr->type_slot >> 62; // type is 2 upper bits of type_slot
}

static inline ulong
tsdk_state_proof_header_slot( tsdk_state_proof_hdr_t const * hdr ) {
  return hdr->type_slot & (( 1UL << 62 ) - 1 ); // lower 62 bits of type_slot
}

static inline ulong
tsdk_state_proof_footprint_from_header( tsdk_state_proof_hdr_t const * hdr ) {
  int sibling_hash_cnt = __builtin_popcountll( hdr->path_bitset.ul[0] ) +
                         __builtin_popcountll( hdr->path_bitset.ul[1] ) +
                         __builtin_popcountll( hdr->path_bitset.ul[2] ) +
                         __builtin_popcountll( hdr->path_bitset.ul[3] );

  ulong type    = tsdk_state_proof_header_type( hdr );
  ulong body_sz = ( type + (ulong)sibling_hash_cnt ) * sizeof( tn_hash_t );

  return sizeof( tsdk_state_proof_hdr_t ) + body_sz;
}

/* Utility functions matching main transaction header API */
static inline tn_signature_t const *
tsdk_txn_get_fee_payer_signature( tsdk_txn_t const * txn, ulong txn_sz ) {
  return (tn_signature_t const *)((uchar const *)txn + txn_sz - TN_TXN_SIGNATURE_SZ );
}

/* tsdk_txn_get_msg: Returns the message portion of the transaction
   (everything except the trailing signature). */
static inline uchar const *
tsdk_txn_get_msg( tsdk_txn_t const * txn ) {
  return (uchar const *)txn;
}

/* tsdk_txn_get_msg_sz: Returns the size of the message portion
   (total transaction size minus signature). */
static inline ulong
tsdk_txn_get_msg_sz( ulong txn_sz ) {
  return txn_sz - TN_TXN_SIGNATURE_SZ;
}

static inline tn_pubkey_t const *
tsdk_txn_get_acct_addrs( tsdk_txn_t const * txn ) {
  return &txn->hdr.v1.fee_payer_pubkey;
}

static inline uchar const *
tsdk_txn_get_instr_data( tsdk_txn_t const * txn ) {
  return (uchar const *)((ulong)txn + sizeof( tsdk_txn_hdr_v1_t ) +
                         sizeof( tn_pubkey_t ) *
                         ( txn->hdr.v1.readwrite_accounts_cnt +
                           txn->hdr.v1.readonly_accounts_cnt ));
}

static inline ushort
tsdk_txn_get_instr_data_sz( tsdk_txn_t const * txn ) {
  return txn->hdr.v1.instr_data_sz;
}

static inline ulong
tsdk_txn_get_fee( tsdk_txn_t const * txn ) {
  return txn->hdr.v1.fee;
}

static inline ulong
tsdk_txn_get_start_slot( tsdk_txn_t const * txn ) {
  return txn->hdr.v1.start_slot;
}

static inline ulong
tsdk_txn_get_expiry_slot( tsdk_txn_t const * txn ) {
  return txn->hdr.v1.start_slot + txn->hdr.v1.expiry_after;
}

static inline ulong
tsdk_txn_get_nonce( tsdk_txn_t const * txn ) {
  return txn->hdr.v1.nonce;
}

static inline ushort
tsdk_txn_get_chain_id( tsdk_txn_t const * txn ) {
  return txn->hdr.v1.chain_id;
}

static inline ulong
tsdk_txn_get_requested_compute_units( tsdk_txn_t const * txn ) {
  return txn->hdr.v1.req_compute_units;
}

static inline ulong
tsdk_txn_get_requested_memory_units( tsdk_txn_t const * txn ) {
  return txn->hdr.v1.req_memory_units;
}

static inline int
tsdk_txn_has_fee_payer_state_proof( tsdk_txn_t const * txn ) {
  return ( txn->hdr.v1.flags & ( 1U << TN_TXN_FLAG_HAS_FEE_PAYER_PROOF )) != 0;
}

static inline ulong
tsdk_txn_readwrite_account_cnt( tsdk_txn_t const * txn ) {
  return txn->hdr.v1.readwrite_accounts_cnt;
}

static inline ulong
tsdk_txn_readonly_account_cnt( tsdk_txn_t const * txn ) {
  return txn->hdr.v1.readonly_accounts_cnt;
}

static inline ushort
tsdk_txn_account_cnt( tsdk_txn_t const * txn ) {
  return (ushort)( 2U + txn->hdr.v1.readonly_accounts_cnt +
                   txn->hdr.v1.readwrite_accounts_cnt );
}

static inline int
tsdk_txn_is_account_idx_writable( tsdk_txn_t const * txn,
                                  ushort             acc_idx ) {
  return ( acc_idx == 0U ) ||
    (( acc_idx >= 2U ) &&
     ( acc_idx < ( 2 + txn->hdr.v1.readwrite_accounts_cnt )));
}

#endif /* HEADER_tn_sdk_txn_h */

