#ifndef HEADER_tn_sdk_types_h
#define HEADER_tn_sdk_types_h

#include "tn_sdk_base.h"

/* Standalone type definitions for ThruNet C SDK */

/* Transaction constants matching main transaction header */
#define TN_TXN_SIGNATURE_SZ (64UL)
#define TN_TXN_PUBKEY_SZ    (32UL)
#define TN_TXN_ACCT_ADDR_SZ (32UL)
#define TN_TXN_BLOCKHASH_SZ (32UL)

/* Transaction version */
#define TN_TXN_V1      ((uchar)0x01)

/* Transaction flags */
#define TN_TXN_FLAG_HAS_FEE_PAYER_PROOF  (0U)

#define TN_HASH_FOOTPRINT (32UL)
#define TN_HASH_ALIGN (8UL)
#define TN_PUBKEY_FOOTPRINT TN_HASH_FOOTPRINT

/* Account version */
#define TN_ACCOUNT_V1 (0x01UL)

/* TODO this should not have packed alignment, but it's misused everywhere */
union __attribute__((packed)) tn_hash {
  uchar hash[ TN_HASH_FOOTPRINT ];
  uchar key [ TN_HASH_FOOTPRINT ]; // Making fd_hash and fd_pubkey interchangeable

  // Generic type specific accessors
  ulong ul  [ TN_HASH_FOOTPRINT / sizeof(ulong) ];
  uint  ui  [ TN_HASH_FOOTPRINT / sizeof(uint)  ];
  uchar uc  [ TN_HASH_FOOTPRINT ];
};

typedef union tn_hash tn_hash_t;
typedef union tn_hash tn_pubkey_t;


/* 64-byte signature type - compatible with fd_signature_t */
typedef union {
  uchar uc[64];
  ulong ul[8];
} tn_signature_t;

#endif /* HEADER_tn_sdk_types_h */
