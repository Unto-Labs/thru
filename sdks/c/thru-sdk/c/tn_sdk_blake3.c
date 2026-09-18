#include "tn_sdk_blake3.h"
#include <string.h>

/* Faithful port of the official BLAKE3 reference implementation
   (https://github.com/BLAKE3-team/BLAKE3 reference_impl.c), reduced to the
   regular (unkeyed) hash with a 32-byte output.  Pure portable C so the
   output matches Firedancer/Ballet BLAKE3 byte-for-byte on both the VM
   (RISC-V) and host targets. */

#define TSDK_BLAKE3_CHUNK_START         (1U << 0)
#define TSDK_BLAKE3_CHUNK_END           (1U << 1)
#define TSDK_BLAKE3_PARENT              (1U << 2)
#define TSDK_BLAKE3_ROOT                (1U << 3)

static uint const TSDK_BLAKE3_IV[ 8 ] = {
  0x6A09E667U, 0xBB67AE85U, 0x3C6EF372U, 0xA54FF53AU,
  0x510E527FU, 0x9B05688CU, 0x1F83D9ABU, 0x5BE0CD19U
};

static ulong const TSDK_BLAKE3_MSG_PERMUTATION[ 16 ] = {
  2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8
};

static inline uint
tsdk_blake3_rotr( uint x, int n ) {
  return ( x >> n ) | ( x << ( 32 - n ) );
}

static inline uint
tsdk_blake3_load32( void const * src ) {
  uchar const * p = (uchar const *)src;
  return ( (uint)p[0]       ) | ( (uint)p[1] <<  8 ) |
         ( (uint)p[2] << 16 ) | ( (uint)p[3] << 24 );
}

static void
tsdk_blake3_words_from_le_bytes( void const * bytes, ulong bytes_len, uint * out ) {
  uchar const * u8 = (uchar const *)bytes;
  for( ulong i = 0UL; i < bytes_len / 4UL; i++ ) {
    out[ i ] = tsdk_blake3_load32( &u8[ 4UL * i ] );
  }
}

static inline void
tsdk_blake3_g( uint * state, ulong a, ulong b, ulong c, ulong d, uint mx, uint my ) {
  state[a] = state[a] + state[b] + mx;
  state[d] = tsdk_blake3_rotr( state[d] ^ state[a], 16 );
  state[c] = state[c] + state[d];
  state[b] = tsdk_blake3_rotr( state[b] ^ state[c], 12 );
  state[a] = state[a] + state[b] + my;
  state[d] = tsdk_blake3_rotr( state[d] ^ state[a], 8 );
  state[c] = state[c] + state[d];
  state[b] = tsdk_blake3_rotr( state[b] ^ state[c], 7 );
}

static void
tsdk_blake3_round( uint * state, uint const * m ) {
  /* Mix the columns. */
  tsdk_blake3_g( state, 0, 4,  8, 12, m[ 0], m[ 1] );
  tsdk_blake3_g( state, 1, 5,  9, 13, m[ 2], m[ 3] );
  tsdk_blake3_g( state, 2, 6, 10, 14, m[ 4], m[ 5] );
  tsdk_blake3_g( state, 3, 7, 11, 15, m[ 6], m[ 7] );
  /* Mix the diagonals. */
  tsdk_blake3_g( state, 0, 5, 10, 15, m[ 8], m[ 9] );
  tsdk_blake3_g( state, 1, 6, 11, 12, m[10], m[11] );
  tsdk_blake3_g( state, 2, 7,  8, 13, m[12], m[13] );
  tsdk_blake3_g( state, 3, 4,  9, 14, m[14], m[15] );
}

static void
tsdk_blake3_permute( uint * m ) {
  uint permuted[ 16 ];
  for( ulong i = 0UL; i < 16UL; i++ ) permuted[ i ] = m[ TSDK_BLAKE3_MSG_PERMUTATION[ i ] ];
  memcpy( m, permuted, sizeof( permuted ) );
}

static void
tsdk_blake3_compress( uint const * chaining_value,
                      uint const * block_words,
                      ulong        counter,
                      uint         block_len,
                      uint         flags,
                      uint *       out /* 16 words */ ) {
  uint state[ 16 ] = {
    chaining_value[0], chaining_value[1], chaining_value[2], chaining_value[3],
    chaining_value[4], chaining_value[5], chaining_value[6], chaining_value[7],
    TSDK_BLAKE3_IV[0], TSDK_BLAKE3_IV[1], TSDK_BLAKE3_IV[2], TSDK_BLAKE3_IV[3],
    (uint)counter, (uint)( counter >> 32 ), block_len, flags
  };
  uint block[ 16 ];
  memcpy( block, block_words, sizeof( block ) );

  tsdk_blake3_round( state, block ); /* round 1 */
  tsdk_blake3_permute( block );
  tsdk_blake3_round( state, block ); /* round 2 */
  tsdk_blake3_permute( block );
  tsdk_blake3_round( state, block ); /* round 3 */
  tsdk_blake3_permute( block );
  tsdk_blake3_round( state, block ); /* round 4 */
  tsdk_blake3_permute( block );
  tsdk_blake3_round( state, block ); /* round 5 */
  tsdk_blake3_permute( block );
  tsdk_blake3_round( state, block ); /* round 6 */
  tsdk_blake3_permute( block );
  tsdk_blake3_round( state, block ); /* round 7 */

  for( ulong i = 0UL; i < 8UL; i++ ) {
    state[ i ]     ^= state[ i + 8 ];
    state[ i + 8 ] ^= chaining_value[ i ];
  }
  memcpy( out, state, sizeof( state ) );
}

/* Output node: the chaining value (for non-root) or extendable root output. */
struct tsdk_blake3_output {
  uint  input_chaining_value[ 8 ];
  uint  block_words[ 16 ];
  ulong counter;
  uint  block_len;
  uint  flags;
};
typedef struct tsdk_blake3_output tsdk_blake3_output_t;

static void
tsdk_blake3_output_chaining_value( tsdk_blake3_output_t const * self, uint * out /* 8 */ ) {
  uint out16[ 16 ];
  tsdk_blake3_compress( self->input_chaining_value, self->block_words,
                        self->counter, self->block_len, self->flags, out16 );
  memcpy( out, out16, 8UL * sizeof( uint ) );
}

static void
tsdk_blake3_output_root_bytes( tsdk_blake3_output_t const * self, void * out, ulong out_len ) {
  uchar * out_u8               = (uchar *)out;
  ulong   output_block_counter = 0UL;
  while( out_len > 0UL ) {
    uint words[ 16 ];
    tsdk_blake3_compress( self->input_chaining_value, self->block_words,
                          output_block_counter, self->block_len,
                          self->flags | TSDK_BLAKE3_ROOT, words );
    for( ulong word = 0UL; word < 16UL; word++ ) {
      for( int b = 0; b < 4; b++ ) {
        if( out_len == 0UL ) return;
        *out_u8 = (uchar)( words[ word ] >> ( 8 * b ) );
        out_u8++;
        out_len--;
      }
    }
    output_block_counter++;
  }
}

static void
tsdk_blake3_chunk_state_init( tsdk_blake3_chunk_state_t * self,
                              uint const *                key_words,
                              ulong                       chunk_counter,
                              uint                        flags ) {
  memcpy( self->chaining_value, key_words, 8UL * sizeof( uint ) );
  self->chunk_counter     = chunk_counter;
  memset( self->block, 0, TSDK_BLAKE3_BLOCK_LEN );
  self->block_len         = 0;
  self->blocks_compressed = 0;
  self->flags             = flags;
}

static ulong
tsdk_blake3_chunk_state_len( tsdk_blake3_chunk_state_t const * self ) {
  return TSDK_BLAKE3_BLOCK_LEN * (ulong)self->blocks_compressed + (ulong)self->block_len;
}

static uint
tsdk_blake3_chunk_state_start_flag( tsdk_blake3_chunk_state_t const * self ) {
  return ( self->blocks_compressed == 0 ) ? TSDK_BLAKE3_CHUNK_START : 0U;
}

static void
tsdk_blake3_chunk_state_update( tsdk_blake3_chunk_state_t * self,
                                void const *                input,
                                ulong                       input_len ) {
  uchar const * input_u8 = (uchar const *)input;
  while( input_len > 0UL ) {
    if( self->block_len == TSDK_BLAKE3_BLOCK_LEN ) {
      uint block_words[ 16 ];
      tsdk_blake3_words_from_le_bytes( self->block, TSDK_BLAKE3_BLOCK_LEN, block_words );
      uint out16[ 16 ];
      tsdk_blake3_compress( self->chaining_value, block_words, self->chunk_counter,
                            (uint)TSDK_BLAKE3_BLOCK_LEN,
                            self->flags | tsdk_blake3_chunk_state_start_flag( self ),
                            out16 );
      memcpy( self->chaining_value, out16, 8UL * sizeof( uint ) );
      self->blocks_compressed++;
      memset( self->block, 0, TSDK_BLAKE3_BLOCK_LEN );
      self->block_len = 0;
    }
    ulong want = TSDK_BLAKE3_BLOCK_LEN - (ulong)self->block_len;
    ulong take = ( want < input_len ) ? want : input_len;
    memcpy( &self->block[ self->block_len ], input_u8, take );
    self->block_len = (uchar)( self->block_len + take );
    input_u8  += take;
    input_len -= take;
  }
}

static tsdk_blake3_output_t
tsdk_blake3_chunk_state_output( tsdk_blake3_chunk_state_t const * self ) {
  tsdk_blake3_output_t ret;
  memcpy( ret.input_chaining_value, self->chaining_value, 8UL * sizeof( uint ) );
  tsdk_blake3_words_from_le_bytes( self->block, TSDK_BLAKE3_BLOCK_LEN, ret.block_words );
  ret.counter   = self->chunk_counter;
  ret.block_len = (uint)self->block_len;
  ret.flags     = self->flags | tsdk_blake3_chunk_state_start_flag( self ) | TSDK_BLAKE3_CHUNK_END;
  return ret;
}

static tsdk_blake3_output_t
tsdk_blake3_parent_output( uint const * left_child_cv,
                           uint const * right_child_cv,
                           uint const * key_words,
                           uint         flags ) {
  tsdk_blake3_output_t ret;
  memcpy( ret.input_chaining_value, key_words, 8UL * sizeof( uint ) );
  memcpy( &ret.block_words[ 0 ], left_child_cv,  8UL * sizeof( uint ) );
  memcpy( &ret.block_words[ 8 ], right_child_cv, 8UL * sizeof( uint ) );
  ret.counter   = 0UL;
  ret.block_len = (uint)TSDK_BLAKE3_BLOCK_LEN;
  ret.flags     = TSDK_BLAKE3_PARENT | flags;
  return ret;
}

static void
tsdk_blake3_parent_cv( uint const * left_child_cv,
                       uint const * right_child_cv,
                       uint const * key_words,
                       uint         flags,
                       uint *       out /* 8 */ ) {
  tsdk_blake3_output_t o = tsdk_blake3_parent_output( left_child_cv, right_child_cv, key_words, flags );
  tsdk_blake3_output_chaining_value( &o, out );
}

tsdk_blake3_t *
tsdk_blake3_init( tsdk_blake3_t * h ) {
  tsdk_blake3_chunk_state_init( &h->chunk_state, TSDK_BLAKE3_IV, 0UL, 0U );
  memcpy( h->key_words, TSDK_BLAKE3_IV, 8UL * sizeof( uint ) );
  h->cv_stack_len = 0;
  h->flags        = 0U;
  return h;
}

static void
tsdk_blake3_push_stack( tsdk_blake3_t * h, uint const * cv ) {
  memcpy( h->cv_stack[ h->cv_stack_len ], cv, 8UL * sizeof( uint ) );
  h->cv_stack_len++;
}

static void
tsdk_blake3_pop_stack( tsdk_blake3_t * h, uint * out ) {
  h->cv_stack_len--;
  memcpy( out, h->cv_stack[ h->cv_stack_len ], 8UL * sizeof( uint ) );
}

static void
tsdk_blake3_add_chunk_cv( tsdk_blake3_t * h, uint * new_cv, ulong total_chunks ) {
  while( ( total_chunks & 1UL ) == 0UL ) {
    uint left[ 8 ];
    tsdk_blake3_pop_stack( h, left );
    tsdk_blake3_parent_cv( left, new_cv, h->key_words, h->flags, new_cv );
    total_chunks >>= 1;
  }
  tsdk_blake3_push_stack( h, new_cv );
}

tsdk_blake3_t *
tsdk_blake3_append( tsdk_blake3_t * h, void const * data, ulong sz ) {
  uchar const * input_u8 = (uchar const *)data;
  while( sz > 0UL ) {
    if( tsdk_blake3_chunk_state_len( &h->chunk_state ) == TSDK_BLAKE3_CHUNK_LEN ) {
      tsdk_blake3_output_t o = tsdk_blake3_chunk_state_output( &h->chunk_state );
      uint  chunk_cv[ 8 ];
      tsdk_blake3_output_chaining_value( &o, chunk_cv );
      ulong total_chunks = h->chunk_state.chunk_counter + 1UL;
      tsdk_blake3_add_chunk_cv( h, chunk_cv, total_chunks );
      tsdk_blake3_chunk_state_init( &h->chunk_state, h->key_words, total_chunks, h->flags );
    }
    ulong want = TSDK_BLAKE3_CHUNK_LEN - tsdk_blake3_chunk_state_len( &h->chunk_state );
    ulong take = ( want < sz ) ? want : sz;
    tsdk_blake3_chunk_state_update( &h->chunk_state, input_u8, take );
    input_u8 += take;
    sz       -= take;
  }
  return h;
}

void *
tsdk_blake3_fini( tsdk_blake3_t * h, void * hash ) {
  tsdk_blake3_output_t current_output = tsdk_blake3_chunk_state_output( &h->chunk_state );
  ulong parent_nodes_remaining = (ulong)h->cv_stack_len;
  while( parent_nodes_remaining > 0UL ) {
    parent_nodes_remaining--;
    uint current_cv[ 8 ];
    tsdk_blake3_output_chaining_value( &current_output, current_cv );
    current_output = tsdk_blake3_parent_output( h->cv_stack[ parent_nodes_remaining ],
                                                current_cv, h->key_words, h->flags );
  }
  tsdk_blake3_output_root_bytes( &current_output, hash, TSDK_BLAKE3_OUT_LEN );
  return hash;
}

void *
tsdk_blake3_hash( void const * data, ulong sz, void * hash ) {
  tsdk_blake3_t h[ 1 ];
  tsdk_blake3_init( h );
  tsdk_blake3_append( h, data, sz );
  return tsdk_blake3_fini( h, hash );
}
