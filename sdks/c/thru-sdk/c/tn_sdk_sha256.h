#ifndef HEADER_tn_src_thru_programs_sdk_tn_sdk_sha256_h
#define HEADER_tn_src_thru_programs_sdk_tn_sdk_sha256_h

#include "tn_sdk.h"
#include "tn_sdk_base.h"

/* TODO: this should use the Firedancer sha256 implementation or at least the
   same interface. I would like to avoid having to copy the sha256
   implementation into the ThruVM SDK. */

/* This sha256 implementation is from the Firedancer project. */

#define TSDK_SHA256_LG_BLOCK_SZ (6)
#define TSDK_SHA256_BLOCK_SZ                                                   \
  (64UL) /* == 2^FD_SHA256_LG_BLOCK_SZ, explicit to workaround compiler        \
            limitations */

#define TSDK_SHA256_PRIVATE_LG_BUF_MAX TSDK_SHA256_LG_BLOCK_SZ
#define TSDK_SHA256_PRIVATE_BUF_MAX TSDK_SHA256_BLOCK_SZ

/* Incremental SHA256 hashing API */

/* Context structure for incremental SHA256 hashing.
   It is simplified from fd_sha256_t for SDK use. */
struct tsdk_sha256 {
  uint state[8];                          /* Current hash state H^(i-1) */
  uchar buf[TSDK_SHA256_PRIVATE_BUF_MAX]; /* Buffer for partial blocks */
  ulong buf_used;                         /* Number of bytes used in buf */
  ulong bit_cnt;                          /* Total number of bits processed */
};
typedef struct tsdk_sha256 tsdk_sha256_t;

/* Initializes the SHA256 context. */
tsdk_sha256_t* tsdk_sha256_init(tsdk_sha256_t* sha);

/* Appends data to the SHA256 context. */
tsdk_sha256_t* tsdk_sha256_append(tsdk_sha256_t* sha, void const* data,
                                  ulong sz);

/* Finalizes the SHA256 calculation and stores the hash. */
void* tsdk_sha256_fini(tsdk_sha256_t* sha, void* hash);

void* tsdk_sha256_hash(void const* _data, ulong sz, void* _hash);

#endif /* HEADER_tn_src_thru_programs_sdk_tn_sdk_sha256_h */
