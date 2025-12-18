#ifndef HEADER_tn_src_thru_programs_sdk_tn_sdk_types_h
#define HEADER_tn_src_thru_programs_sdk_tn_sdk_types_h

#include <stdalign.h>
#include <string.h>
typedef unsigned char uchar;
typedef unsigned short ushort;
typedef unsigned int uint;
typedef unsigned long ulong;

#define TSDK_PARAM_UNUSED __attribute__((unused))

#define TSDK_LIKELY(c) __builtin_expect(!!(c), 1L)
#define TSDK_UNLIKELY(c) __builtin_expect(!!(c), 0L)

#define TSDK_FN_NORETURN __attribute__((noreturn))

#ifdef __cplusplus
#define TSDK_PROTOTYPES_BEGIN extern "C" {
#else
#define TSDK_PROTOTYPES_BEGIN
#endif

#ifdef __cplusplus
#define TSDK_PROTOTYPES_END }
#else
#define TSDK_PROTOTYPES_END
#endif

// macro concat stuff

#define TSDK_CONCAT3(a, b, c) a##b##c
#define TSDK_EXPAND_THEN_CONCAT3(a, b, c) TSDK_CONCAT3(a, b, c)

/* Bit manipulation utilities from fd_bits.h */

#ifndef TSDK_FN_CONST
#define TSDK_FN_CONST
#endif

#ifndef TSDK_FN_PURE
#define TSDK_FN_PURE
#endif

#define TSDK_FN_UNUSED __attribute__((unused))

TSDK_FN_CONST static inline int tsdk_ulong_is_aligned(ulong x, ulong a) {
  a--;
  return !(x & a);
}
TSDK_FN_CONST static inline ulong tsdk_ulong_align_up(ulong x, ulong a) {
  a--;
  return (ulong)((x + a) & ~a);
}

TSDK_FN_CONST static inline ulong tsdk_ulong_hash(ulong x) {
  x ^= x >> 33;
  x *= 0xff51afd7ed558ccdUL;
  x ^= x >> 33;
  x *= 0xc4ceb9fe1a85ec53UL;
  x ^= x >> 33;
  return x;
}

#define ROTATE_LEFT(x,r) (((x)<<(r)) | ((x)>>(64-(r))))
#define C1 (11400714785074694791UL)
#define C2 (14029467366897019727UL)
#define C3 ( 1609587929392839161UL)
#define C4 ( 9650029242287828579UL)
#define C5 ( 2870177450012600261UL)


static inline ulong
tsdk_hash( ulong        seed,
         void const * buf,
         ulong        sz ) {
  uchar const * p    = ((uchar const *)buf);
  uchar const * stop = p + sz;

  ulong h;

  if( sz<32 ) h = seed + C5;
  else {
    uchar const * stop32 = stop - 32;
    ulong w = seed + (C1+C2);
    ulong x = seed + C2;
    ulong y = seed;
    ulong z = seed - C1;

    do { /* All complete blocks of 32 */
      w += (((ulong const *)p)[0])*C2; w = ROTATE_LEFT( w, 31 ); w *= C1;
      x += (((ulong const *)p)[1])*C2; x = ROTATE_LEFT( x, 31 ); x *= C1;
      y += (((ulong const *)p)[2])*C2; y = ROTATE_LEFT( y, 31 ); y *= C1;
      z += (((ulong const *)p)[3])*C2; z = ROTATE_LEFT( z, 31 ); z *= C1;
      p += 32;
    } while( p<=stop32 );

    h = ROTATE_LEFT( w, 1 ) + ROTATE_LEFT( x, 7 ) + ROTATE_LEFT( y, 12 ) + ROTATE_LEFT( z, 18 );

    w *= C2; w = ROTATE_LEFT( w, 31 ); w *= C1; h ^= w; h = h*C1 + C4;
    x *= C2; x = ROTATE_LEFT( x, 31 ); x *= C1; h ^= x; h = h*C1 + C4;
    y *= C2; y = ROTATE_LEFT( y, 31 ); y *= C1; h ^= y; h = h*C1 + C4;
    z *= C2; z = ROTATE_LEFT( z, 31 ); z *= C1; h ^= z; h = h*C1 + C4;
  }

  h += ((ulong)sz);

  while( (p+8)<=stop ) { /* Last 1 to 3 complete ulong's */
    ulong w = ((ulong const *)p)[0];
    w *= C2; w = ROTATE_LEFT( w, 31 ); w *= C1; h ^= w; h = ROTATE_LEFT( h, 27 )*C1 + C4;
    p += 8;
  }

  if( (p+4)<=stop ) { /* Last complete uint */
    ulong w = ((ulong)(((uint const *)p)[0]));
    w *= C1; h ^= w; h = ROTATE_LEFT( h, 23 )*C2 + C3;
    p += 4;
  }

  while( p<stop ) { /* Last 1 to 3 uchar's */
    ulong w = ((ulong)(p[0]));
    w *= C5; h ^= w; h = ROTATE_LEFT( h, 11 )*C1;
    p++;
  }

  /* Final avalanche */
  h ^= h >> 33;
  h *= C2;
  h ^= h >> 29;
  h *= C3;
  h ^= h >> 32;

  return h;
}

#define TSDK_STRINGIFY(x) #x
#define TSDK_EXPAND_THEN_STRINGIFY(x) TSDK_STRINGIFY(x)
#define TSDK_SRC_LOCATION __FILE__ "(" TSDK_EXPAND_THEN_STRINGIFY(__LINE__) ")"
#define TSDK_COMPILER_FORGET(var)                                              \
  __asm__("# FD_COMPILER_FORGET(" #var ")@" TSDK_SRC_LOCATION : "+r"(var))

TSDK_FN_PURE static inline ulong tsdk_ulong_load_8(void const* p) {
  ulong t;
  memcpy(&t, p, 8UL);
  return t;
}

#define TSDK_LAYOUT_INIT              (0UL)
#define TSDK_LAYOUT_APPEND( l, a, s ) (tsdk_ulong_align_up( (l), (ulong)(a) ) + (ulong)(s))
#define TSDK_LAYOUT_FINI( l, a )      tsdk_ulong_align_up( (l), (ulong)(a) )

#define TSDK_SCRATCH_ALLOC_INIT(   layout, base )  ulong _##layout = (ulong)(base)
#define TSDK_SCRATCH_ALLOC_APPEND( layout, align, sz ) (__extension__({                               \
    ulong _sz    = (ulong)(sz);                                                                     \
    ulong _scratch_alloc = tsdk_ulong_align_up( _##layout, (ulong)(align) );                        \
    if( TSDK_UNLIKELY( _scratch_alloc+_sz<_scratch_alloc ) )                                        \
      tsdk_revert(1);                                                                               \
    _##layout = _scratch_alloc + _sz;                                                               \
    (void *)_scratch_alloc;                                                                         \
    }))
#define TSDK_SCRATCH_ALLOC_FINI( layout, align ) (_##layout = tsdk_ulong_align_up( _##layout, (ulong)(align) ) )
#endif /* HEADER_tn_src_thru_programs_sdk_tn_sdk_types_h */
