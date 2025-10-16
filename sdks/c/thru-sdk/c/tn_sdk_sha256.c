#include "tn_sdk_sha256.h"
#include <string.h>

static void
tsdk_sha256_core_ref( uint *        state,
                    uchar const * block,
                    ulong         block_cnt ) {

  static uint const K[64] = {
    0x428a2f98U, 0x71374491U, 0xb5c0fbcfU, 0xe9b5dba5U, 0x3956c25bU, 0x59f111f1U, 0x923f82a4U, 0xab1c5ed5U,
    0xd807aa98U, 0x12835b01U, 0x243185beU, 0x550c7dc3U, 0x72be5d74U, 0x80deb1feU, 0x9bdc06a7U, 0xc19bf174U,
    0xe49b69c1U, 0xefbe4786U, 0x0fc19dc6U, 0x240ca1ccU, 0x2de92c6fU, 0x4a7484aaU, 0x5cb0a9dcU, 0x76f988daU,
    0x983e5152U, 0xa831c66dU, 0xb00327c8U, 0xbf597fc7U, 0xc6e00bf3U, 0xd5a79147U, 0x06ca6351U, 0x14292967U,
    0x27b70a85U, 0x2e1b2138U, 0x4d2c6dfcU, 0x53380d13U, 0x650a7354U, 0x766a0abbU, 0x81c2c92eU, 0x92722c85U,
    0xa2bfe8a1U, 0xa81a664bU, 0xc24b8b70U, 0xc76c51a3U, 0xd192e819U, 0xd6990624U, 0xf40e3585U, 0x106aa070U,
    0x19a4c116U, 0x1e376c08U, 0x2748774cU, 0x34b0bcb5U, 0x391c0cb3U, 0x4ed8aa4aU, 0x5b9cca4fU, 0x682e6ff3U,
    0x748f82eeU, 0x78a5636fU, 0x84c87814U, 0x8cc70208U, 0x90befffaU, 0xa4506cebU, 0xbef9a3f7U, 0xc67178f2U,
  };

# define Sigma0(x, res)  {__asm__("sha256sum0 %0,%1" : "=r" (res) : "r" (x));}
# define Sigma1(x, res)  {__asm__("sha256sum1 %0,%1" : "=r" (res) : "r" (x));}
# define sigma0(x, res)  {__asm__("sha256sig0 %0,%1" : "=r" (res) : "r" (x));}
# define sigma1(x, res)  {__asm__("sha256sig1 %0,%1" : "=r" (res) : "r" (x));}
# define Ch(x,y,z)  (((x) & (y)) ^ ((~(x)) & (z)))
# define Maj(x,y,z) (((x) & (y)) ^ ((x) & (z)) ^ ((y) & (z)))

  uint const * W = (uint const *)block;
  do {
    uint a = state[0];
    uint b = state[1];
    uint c = state[2];
    uint d = state[3];
    uint e = state[4];
    uint f = state[5];
    uint g = state[6];
    uint h = state[7];

    uint X[16];

    ulong i;
    for( i=0UL; i<16UL; i++ ) {
      X[i] = __builtin_bswap32( W[i] );
      uint sum1_e, sum0_a;
      Sigma1(e, sum1_e);
      Sigma0(a, sum0_a);
      uint T1 = X[i] + h + sum1_e + Ch(e, f, g) + K[i];
      uint T2 = sum0_a + Maj(a, b, c);
      h = g;
      g = f;
      f = e;
      e = d + T1;
      d = c;
      c = b;
      b = a;
      a = T1 + T2;
    }
    for( ; i<64UL; i++ ) {
      uint s0 = X[(i +  1UL) & 0x0fUL];
      uint s1 = X[(i + 14UL) & 0x0fUL];
      sigma0(s0, s0);
      sigma1(s1, s1);
      X[i & 0xfUL] += s0 + s1 + X[(i + 9UL) & 0xfUL];
      uint sum1_e2, sum0_a2;
      Sigma1(e, sum1_e2);
      Sigma0(a, sum0_a2);
      uint T1 = X[i & 0xfUL ] + h + sum1_e2 + Ch(e, f, g) + K[i];
      uint T2 = sum0_a2 + Maj(a, b, c);
      h = g;
      g = f;
      f = e;
      e = d + T1;
      d = c;
      c = b;
      b = a;
      a = T1 + T2;
    }

    state[0] += a;
    state[1] += b;
    state[2] += c;
    state[3] += d;
    state[4] += e;
    state[5] += f;
    state[6] += g;
    state[7] += h;

    W += 16UL;
  } while( --block_cnt );

# undef sum0
# undef sum1
# undef Sigma0
# undef Sigma1
# undef sigma0
# undef sigma1
# undef Ch
# undef Maj

}

#define tsdk_sha256_core tsdk_sha256_core_ref

void *
tsdk_sha256_hash( void const * _data,
                  ulong        sz,
                  void *       _hash ) {
  uchar const * data = (uchar const *)_data;

  /* This is just the above streamlined to eliminate all the overheads
     to support incremental hashing. */

  uchar buf[ TSDK_SHA256_PRIVATE_BUF_MAX ] __attribute__((aligned(128)));
  uint  state[8] __attribute__((aligned(32)));

  state[0] = 0x6a09e667U;
  state[1] = 0xbb67ae85U;
  state[2] = 0x3c6ef372U;
  state[3] = 0xa54ff53aU;
  state[4] = 0x510e527fU;
  state[5] = 0x9b05688cU;
  state[6] = 0x1f83d9abU;
  state[7] = 0x5be0cd19U;

  ulong block_cnt = sz >> TSDK_SHA256_PRIVATE_LG_BUF_MAX;
  if( TSDK_LIKELY( block_cnt ) ) tsdk_sha256_core( state, data, block_cnt );

  ulong buf_used = sz & (TSDK_SHA256_PRIVATE_BUF_MAX-1UL);
  if( TSDK_UNLIKELY( buf_used ) ) memcpy( buf, data + (block_cnt << TSDK_SHA256_PRIVATE_LG_BUF_MAX), buf_used );
  buf[ buf_used ] = (uchar)0x80;
  buf_used++;

  if( TSDK_UNLIKELY( buf_used > (TSDK_SHA256_PRIVATE_BUF_MAX-8UL) ) ) {
    memset( buf + buf_used, 0, TSDK_SHA256_PRIVATE_BUF_MAX-buf_used );
    tsdk_sha256_core( state, buf, 1UL );
    buf_used = 0UL;
  }

  ulong bit_cnt = sz << 3;
  memset( buf + buf_used, 0, TSDK_SHA256_PRIVATE_BUF_MAX-8UL-buf_used );
  TSDK_STORE( ulong, buf+TSDK_SHA256_PRIVATE_BUF_MAX-8UL, __builtin_bswap64( bit_cnt ) );
  tsdk_sha256_core( state, buf, 1UL );

  state[0] = __builtin_bswap32( state[0] );
  state[1] = __builtin_bswap32( state[1] );
  state[2] = __builtin_bswap32( state[2] );
  state[3] = __builtin_bswap32( state[3] );
  state[4] = __builtin_bswap32( state[4] );
  state[5] = __builtin_bswap32( state[5] );
  state[6] = __builtin_bswap32( state[6] );
  state[7] = __builtin_bswap32( state[7] );
  return memcpy( _hash, state, 32 );
}

tsdk_sha256_t *
tsdk_sha256_init( tsdk_sha256_t * sha ) {
  sha->state[0] = 0x6a09e667U;
  sha->state[1] = 0xbb67ae85U;
  sha->state[2] = 0x3c6ef372U;
  sha->state[3] = 0xa54ff53aU;
  sha->state[4] = 0x510e527fU;
  sha->state[5] = 0x9b05688cU;
  sha->state[6] = 0x1f83d9abU;
  sha->state[7] = 0x5be0cd19U;
  sha->buf_used = 0UL;
  sha->bit_cnt  = 0UL;
  return sha;
}

tsdk_sha256_t *
tsdk_sha256_append( tsdk_sha256_t * sha,
                    void const *  _data,
                    ulong         sz ) {
  if( TSDK_UNLIKELY( !sz ) ) return sha;

  uint *  state    = sha->state;
  uchar * buf      = sha->buf;
  ulong   buf_used = sha->buf_used;
  // ulong   bit_cnt  = sha->bit_cnt; // bit_cnt is updated directly in sha->bit_cnt

  uchar const * data = (uchar const *)_data;

  sha->bit_cnt += (sz<<3);

  if( TSDK_UNLIKELY( buf_used ) ) {
    ulong buf_rem = TSDK_SHA256_PRIVATE_BUF_MAX - buf_used;
    if( TSDK_UNLIKELY( sz < buf_rem ) ) {
      memcpy( buf + buf_used, data, sz );
      sha->buf_used = buf_used + sz;
      return sha;
    }

    memcpy( buf + buf_used, data, buf_rem );
    data += buf_rem;
    sz   -= buf_rem;

    tsdk_sha256_core( state, buf, 1UL );
    sha->buf_used = 0UL;
  }

  ulong block_cnt = sz >> TSDK_SHA256_PRIVATE_LG_BUF_MAX;
  if( TSDK_LIKELY( block_cnt ) ) tsdk_sha256_core( state, data, block_cnt );

  buf_used = sz & (TSDK_SHA256_PRIVATE_BUF_MAX-1UL);
  if( TSDK_UNLIKELY( buf_used ) ) {
    memcpy( buf, data + (block_cnt << TSDK_SHA256_PRIVATE_LG_BUF_MAX), buf_used );
    sha->buf_used = buf_used;
  }

  return sha;
}

void *
tsdk_sha256_fini( tsdk_sha256_t * sha,
                  void *        _hash ) {
  uint *  state    = sha->state;
  uchar * buf      = sha->buf;
  ulong   buf_used = sha->buf_used;
  ulong   bit_cnt  = sha->bit_cnt;

  buf[ buf_used ] = (uchar)0x80;
  buf_used++;

  if( TSDK_UNLIKELY( buf_used > (TSDK_SHA256_PRIVATE_BUF_MAX-8UL) ) ) {
    memset( buf + buf_used, 0, TSDK_SHA256_PRIVATE_BUF_MAX-buf_used );
    tsdk_sha256_core( state, buf, 1UL );
    buf_used = 0UL;
  }

  memset( buf + buf_used, 0, TSDK_SHA256_PRIVATE_BUF_MAX-8UL-buf_used );
  TSDK_STORE( ulong, buf+TSDK_SHA256_PRIVATE_BUF_MAX-8UL, __builtin_bswap64( bit_cnt ) );
  tsdk_sha256_core( state, buf, 1UL );

  state[0] = __builtin_bswap32( state[0] );
  state[1] = __builtin_bswap32( state[1] );
  state[2] = __builtin_bswap32( state[2] );
  state[3] = __builtin_bswap32( state[3] );
  state[4] = __builtin_bswap32( state[4] );
  state[5] = __builtin_bswap32( state[5] );
  state[6] = __builtin_bswap32( state[6] );
  state[7] = __builtin_bswap32( state[7] );
  return memcpy( _hash, state, 32 );
}
