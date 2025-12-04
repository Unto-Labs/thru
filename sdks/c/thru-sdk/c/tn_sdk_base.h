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

#endif /* HEADER_tn_src_thru_programs_sdk_tn_sdk_types_h */
