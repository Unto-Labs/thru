#include "tn_rle.h"

ulong
tn_rle_footprint( ushort max_runs ) {
  return sizeof( tn_rle_t ) + ( (ulong)max_runs * sizeof( ushort ));
}

tn_rle_t *
tn_rle_new( void * shmem, ushort max_runs ) {
  tn_rle_t * rle = (tn_rle_t *)shmem;

  rle->first_bit = 0;
  rle->run_count = 0;

  for( ushort i = 0; i < max_runs; i++ ) {
    rle->runs[ i ] = 0;
  }

  return rle;
}

void *
tn_rle_delete( tn_rle_t * rle ) {
  return rle;
}

int
tn_rle_encode( tn_rle_t *    rle,
               ushort        max_runs,
               ulong const * bitset,
               ulong         bit_count ) {
  if( TN_RLE_UNLIKELY( !rle || !bitset ) ) {
    return TN_RLE_ERR_INVALID_PARAM;
  }

  if( TN_RLE_UNLIKELY( bit_count == 0 ) ) {
    rle->run_count = 0;
    rle->first_bit = 0;
    return TN_RLE_SUCCESS;
  }

  rle->run_count = 0;

  ulong current_bit = ( bitset[ 0 ] >> 63UL ) & 1UL;
  rle->first_bit = (ushort)current_bit;

  ushort run_length = 1;

  for( ulong i = 1; i < bit_count; i++ ) {
    ulong bit = ( bitset[ i / 64UL ] >> ( 63UL - ( i % 64UL ))) & 1UL;

    if( bit == current_bit ) {
      if( run_length == 65535 ) {
        if( rle->run_count >= max_runs ) {
          return TN_RLE_ERR_RUNS_TOO_SMALL;
        }
        rle->runs[ rle->run_count++ ] = 65535;
        run_length                    = 0;
      }
      run_length++;
    } else {
      if( rle->run_count >= max_runs ) {
        return TN_RLE_ERR_RUNS_TOO_SMALL;
      }
      rle->runs[ rle->run_count++ ] = run_length;
      current_bit                   = bit;
      run_length                    = 1;
    }
  }

  if( rle->run_count >= max_runs ) {
    return TN_RLE_ERR_RUNS_TOO_SMALL;
  }
  rle->runs[ rle->run_count++ ] = run_length;

  return TN_RLE_SUCCESS;
}

ulong
tn_rle_total_bits( tn_rle_t const * rle ) {
  ulong sum = 0;
  for( ushort i = 0; i < rle->run_count; i++ ) {
    sum += rle->runs[ i ];
  }
  return sum;
}

static int
check_bitset_size( tn_rle_t const * rle, ulong max_bits ) {
  if( tn_rle_total_bits( rle ) > max_bits ) {
    return TN_RLE_ERR_BITSET_TOO_SMALL;
  }
  return TN_RLE_SUCCESS;
}

int
tn_rle_decode( tn_rle_t const * rle,
               ulong *          bitset,
               ulong            max_bits,
               ulong *          out_bit_count ) {
  if( TN_RLE_UNLIKELY( !rle || !bitset || !out_bit_count ) ) {
    return TN_RLE_ERR_INVALID_PARAM;
  }

  int err = check_bitset_size( rle, max_bits );
  if( TN_RLE_UNLIKELY( err != TN_RLE_SUCCESS ) ) {
    return err;
  }

  ushort current_bit = tn_rle_get_first_bit( rle );
  ulong  bit_pos     = 0;

  for( ushort run_idx = 0; run_idx < rle->run_count && bit_pos < max_bits; run_idx++ ) {
    ushort run_length = rle->runs[ run_idx ];

    for( ushort i = 0; i < run_length && bit_pos < max_bits; i++ ) {
      if( current_bit ) {
        bitset[ bit_pos / 64UL ] |= ( 1UL << ( 63UL - ( bit_pos % 64UL )));
      }
      bit_pos++;
    }

    current_bit = (ushort)( 1U - current_bit );
  }

  *out_bit_count = bit_pos;
  return TN_RLE_SUCCESS;
}

int
tn_rle_decode_bytes( tn_rle_t const * rle,
                     uchar *          bitset,
                     ulong            max_bits,
                     ulong *          out_bit_count ) {
  if( TN_RLE_UNLIKELY( !rle || !bitset || !out_bit_count ) ) {
    return TN_RLE_ERR_INVALID_PARAM;
  }

  int err = check_bitset_size( rle, max_bits );
  if( TN_RLE_UNLIKELY( err != TN_RLE_SUCCESS ) ) {
    return err;
  }

  /* Clear bitset first */
  ulong byte_count = ( max_bits + 7UL ) / 8UL;
  for( ulong i = 0; i < byte_count; i++ ) {
    bitset[ i ] = 0;
  }

  uchar current_bit = (uchar)tn_rle_get_first_bit( rle );
  ulong bit_pos     = 0;

  for( ushort run_idx = 0; run_idx < rle->run_count && bit_pos < max_bits; run_idx++ ) {
    ushort run_length = rle->runs[ run_idx ];

    for( ushort i = 0; i < run_length && bit_pos < max_bits; i++ ) {
      if( current_bit ) {
        /* Set bit in big-endian order within each byte */
        bitset[ bit_pos / 8UL ] |= (uchar)( 1U << ( 7U - ( bit_pos % 8UL )));
      }
      bit_pos++;
    }

    current_bit = (uchar)( 1U - current_bit );
  }

  *out_bit_count = bit_pos;
  return TN_RLE_SUCCESS;
}

