#ifndef HEADER_tn_sdk_tn_rle_h
#define HEADER_tn_sdk_tn_rle_h

/* Detect smart contract build via THRU_VM flag set by thruvm.mk */
#ifdef THRU_VM
#include "tn_sdk_base.h"
#include <limits.h>
#define TN_RLE_LIKELY TSDK_LIKELY
#define TN_RLE_UNLIKELY TSDK_UNLIKELY
#define TN_RLE_FN_CONST TSDK_FN_CONST
#else
#include "../../../firedancer/src/util/fd_util.h"
#define TN_RLE_LIKELY FD_LIKELY
#define TN_RLE_UNLIKELY FD_UNLIKELY
#define TN_RLE_FN_CONST FD_FN_CONST
#endif

/* RLE encode/decode error codes */
#define TN_RLE_SUCCESS                   (0)
#define TN_RLE_ERR_RUNS_TOO_SMALL        (-1)
#define TN_RLE_ERR_BITSET_TOO_SMALL      (-2)
#define TN_RLE_ERR_INVALID_PARAM         (-3)

/* RLE structure for run-length encoded bitsets
   Layout: first_bit (2 bytes) + run_count (2 bytes) + runs[] (variable) */
typedef struct __attribute__(( packed )) tn_rle tn_rle_t;
struct __attribute__(( packed )) tn_rle {
  ushort first_bit;   /* Value of first bit (0 or 1) */
  ushort run_count;   /* Number of runs */
  ushort runs[];      /* Length of each run (variable length array) */
};

/* tn_rle_footprint returns the memory footprint for an RLE with max_runs */
TN_RLE_FN_CONST ulong
tn_rle_footprint( ushort max_runs );

/* tn_rle_total_bits returns the total number of bits encoded in the RLE */
ulong
tn_rle_total_bits( tn_rle_t const * rle );

/* tn_rle_new initializes an RLE structure in the given memory */
tn_rle_t *
tn_rle_new( void * shmem, ushort max_runs );

/* tn_rle_delete cleans up an RLE structure */
void *
tn_rle_delete( tn_rle_t * rle );

/* tn_rle_encode encodes a bitset to RLE format
   bitset: array of ulong words, bits in big-endian order within each word
   bit_count: number of bits to encode
   Returns TN_RLE_SUCCESS on success, error code on failure */
int
tn_rle_encode( tn_rle_t *    rle,
               ushort        max_runs,
               ulong const * bitset,
               ulong         bit_count );

/* tn_rle_decode decodes RLE to a bitset (ulong words, big-endian bit order)
   Caller must zero the bitset before calling if merging is not desired
   Returns TN_RLE_SUCCESS on success, error code on failure */
int
tn_rle_decode( tn_rle_t const * rle,
               ulong *          bitset,
               ulong            max_bits,
               ulong *          out_bit_count );

/* tn_rle_decode_bytes decodes RLE to a byte-oriented bitset
   This is useful for smart contracts that work with smaller bitsets
   Caller must zero the bitset before calling if merging is not desired
   Returns TN_RLE_SUCCESS on success, error code on failure */
int
tn_rle_decode_bytes( tn_rle_t const * rle,
                     uchar *          bitset,
                     ulong            max_bits,
                     ulong *          out_bit_count );

/* tn_rle_get_first_bit returns the value of the first bit (0 or 1) */
static inline ushort
tn_rle_get_first_bit( tn_rle_t const * rle ) {
  return rle->first_bit;
}

/* tn_rle_test_bit tests if a bit is set in a byte-oriented bitset */
static inline int
tn_rle_test_bit( uchar const * bitset, ulong idx ) {
  return !!( bitset[ idx / 8UL ] & ( 1U << ( 7U - ( idx % 8UL ))));
}

/* ============================================================================
   RLE Iterator - for iterating over set bits without decoding to a bitset

   This is memory-efficient for large guardian sets (up to 65535 guardians)
   since it requires only ~16 bytes of state instead of 8KB for a full bitset.
   ============================================================================ */

/* Sentinel value indicating no more set bits */
#define TN_RLE_ITER_DONE (ULONG_MAX)

/* Iterator state for walking through RLE set bits */
typedef struct tn_rle_iter tn_rle_iter_t;
struct tn_rle_iter {
  tn_rle_t const * rle;            /* Pointer to RLE data */
  ushort           run_idx;        /* Current run index */
  ushort           pos_in_run;     /* Position within current run */
  ulong            global_bit_idx; /* Overall bit position */
  uchar            current_val;    /* Current run's bit value (0 or 1) */
  uchar            _padding[ 7 ];  /* Alignment padding */
};

/* tn_rle_iter_init initializes an iterator for the given RLE data */
static inline void
tn_rle_iter_init( tn_rle_iter_t * iter, tn_rle_t const * rle ) {
  iter->rle            = rle;
  iter->run_idx        = 0;
  iter->pos_in_run     = 0;
  iter->global_bit_idx = 0;
  iter->current_val    = (uchar)rle->first_bit;
}

/* tn_rle_iter_next_set returns the index of the next set bit (value=1),
   or TN_RLE_ITER_DONE if no more set bits exist within max_bits.

   Example usage:
     tn_rle_iter_t iter;
     tn_rle_iter_init( &iter, rle );
     ulong idx;
     while( ( idx = tn_rle_iter_next_set( &iter, guardian_count ) ) != TN_RLE_ITER_DONE ) {
       // Process guardian at index idx
     }
*/
static inline ulong
tn_rle_iter_next_set( tn_rle_iter_t * iter, ulong max_bits ) {
  while( iter->run_idx < iter->rle->run_count ) {
    ushort run_len = iter->rle->runs[ iter->run_idx ];

    if( iter->current_val ) {
      /* In a run of 1s - yield positions one by one */
      while( iter->pos_in_run < run_len ) {
        if( iter->global_bit_idx >= max_bits ) {
          return TN_RLE_ITER_DONE;
        }
        ulong result = iter->global_bit_idx;
        iter->pos_in_run++;
        iter->global_bit_idx++;
        return result;
      }
      /* Finished this run of 1s, fall through to advance */
    } else {
      /* In a run of 0s - skip entire run */
      iter->global_bit_idx += run_len;
    }

    /* Move to next run */
    iter->run_idx++;
    iter->pos_in_run  = 0;
    iter->current_val = (uchar)( 1U - iter->current_val );
  }

  return TN_RLE_ITER_DONE;
}

#endif /* HEADER_tn_sdk_tn_rle_h */

