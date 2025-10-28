#ifndef HEADER_tn_src_thru_programs_sdk_tn_sdk_types_h
#define HEADER_tn_src_thru_programs_sdk_tn_sdk_types_h

typedef unsigned char uchar;
typedef unsigned short ushort;
typedef unsigned int uint;
typedef unsigned long ulong;

#define TSDK_PARAM_UNUSED __attribute__((unused))

#define TSDK_LIKELY(c) __builtin_expect(!!(c), 1L)
#define TSDK_UNLIKELY(c) __builtin_expect(!!(c), 0L)

#define TSDK_FN_NORETURN __attribute__((noreturn))

#define TSDK_LOAD( T, src ) \
  (__extension__({ T _tsdk_load_tmp; memcpy( &_tsdk_load_tmp, (T const *)(src), sizeof(T) ); _tsdk_load_tmp; }))

#define TSDK_STORE( T, dst, val ) \
  (__extension__({ T _tsdk_store_tmp = (val); (T *)memcpy( (T *)(dst), &_tsdk_store_tmp, sizeof(T) ); }))

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

#endif /* HEADER_tn_src_thru_programs_sdk_tn_sdk_types_h */
