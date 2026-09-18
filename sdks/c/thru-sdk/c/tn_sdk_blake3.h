#ifndef HEADER_tn_src_thru_programs_sdk_tn_sdk_blake3_h
#define HEADER_tn_src_thru_programs_sdk_tn_sdk_blake3_h

#include "tn_sdk_base.h"

/* Portable BLAKE3 for the ThruVM smart-contract SDK (Reward Check Plan A).

   The block layer hashes the canonical block commitment with BLAKE3
   (blake3( "tn-block-commitment" || tn_block_commitment_t )).  The consensus
   validator program must recompute the SAME hash on-chain, so the SDK needs
   a BLAKE3 helper that matches Firedancer/Ballet BLAKE3 byte-for-byte.

   This is a faithful port of the official BLAKE3 reference implementation
   (pure C, no SIMD, no architecture-specific intrinsics) so it compiles and
   produces identical output on both the VM (RISC-V) target and the host.

   API mirrors the SDK SHA-256 helper:

     tsdk_blake3_t * tsdk_blake3_init( tsdk_blake3_t * h );
     tsdk_blake3_t * tsdk_blake3_append( tsdk_blake3_t * h, void const * data, ulong sz );
     void *          tsdk_blake3_fini( tsdk_blake3_t * h, void * hash );  // 32-byte out
     void *          tsdk_blake3_hash( void const * data, ulong sz, void * hash ); */

#define TSDK_BLAKE3_OUT_LEN    (32UL)
#define TSDK_BLAKE3_BLOCK_LEN  (64UL)
#define TSDK_BLAKE3_CHUNK_LEN  (1024UL)
/* Enough subtree chaining values for any practical input (2^54 chunks). */
#define TSDK_BLAKE3_MAX_DEPTH  (54UL)

/* Per-chunk hashing state. */
struct tsdk_blake3_chunk_state {
  uint  chaining_value[ 8 ];
  ulong chunk_counter;
  uchar block[ TSDK_BLAKE3_BLOCK_LEN ];
  uchar block_len;
  uchar blocks_compressed;
  uint  flags;
};
typedef struct tsdk_blake3_chunk_state tsdk_blake3_chunk_state_t;

/* Incremental BLAKE3 hasher.  Stack-allocate as `tsdk_blake3_t h[1];`. */
struct tsdk_blake3 {
  tsdk_blake3_chunk_state_t chunk_state;
  uint                      key_words[ 8 ];
  uint                      cv_stack[ TSDK_BLAKE3_MAX_DEPTH ][ 8 ];
  uchar                     cv_stack_len;
  uint                      flags;
};
typedef struct tsdk_blake3 tsdk_blake3_t;

tsdk_blake3_t * tsdk_blake3_init( tsdk_blake3_t * h );
tsdk_blake3_t * tsdk_blake3_append( tsdk_blake3_t * h, void const * data, ulong sz );
void *          tsdk_blake3_fini( tsdk_blake3_t * h, void * hash );
void *          tsdk_blake3_hash( void const * data, ulong sz, void * hash );

#endif /* HEADER_tn_src_thru_programs_sdk_tn_sdk_blake3_h */
