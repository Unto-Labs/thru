//! Fixed C text shared by every generated package.

/// Macros shared by every generated `types.h` (guarded so several package
/// headers can be included together).
pub const HEADER_RUNTIME: &str = r#"#ifndef TN_ABI_C_RUNTIME_DEFS
#define TN_ABI_C_RUNTIME_DEFS

/* Result codes returned by generated validate/walk/params functions. */
#define TN_ABI_OK                 (0)
#define TN_ABI_ERR_SHORT_BUFFER   (1) /* buffer smaller than the layout requires */
#define TN_ABI_ERR_BAD_TAG        (2) /* enum tag selects no variant */
#define TN_ABI_ERR_OVERFLOW       (3) /* offset or size arithmetic overflowed */
#define TN_ABI_ERR_BAD_SIZE       (4) /* size-discriminated union size matches no variant */
#define TN_ABI_ERR_EXPR           (5) /* size/tag expression failed (e.g. division by zero) */
#define TN_ABI_ERR_ZERO_ELEMENT   (6) /* jagged array element consumed no bytes */
#define TN_ABI_ERR_UNSUPPORTED    (7) /* layout the C backend cannot evaluate */
#define TN_ABI_ERR_INDEX          (8) /* array index out of range */
#define TN_ABI_ERR_INACTIVE       (9) /* enum/SDU variant is not the active one */
#define TN_ABI_ERR_INVALID_ARG   (10) /* NULL pointer argument */

/* Modes for the <Type>_tn_walk layout walkers. */
#define TN_ABI_MODE_TRUST    (0) /* buffer already validated: compute only */
#define TN_ABI_MODE_VALIDATE (1) /* bounds-check every field and validate nested types */
#define TN_ABI_MODE_PARAMS   (2) /* no buffer: compute the footprint from params */
#define TN_ABI_MODE_MEASURE  (3) /* short buffer: compute the size from the bytes present */
#define TN_ABI_MODE_INIT     (4) /* zeroed buffer: lay out from params and write the fields params imply */

/* Variant metadata: one table per enum, size-discriminated union and union
   (<Type>_variants, <Type>_VARIANT_CNT entries plus a NULL-name sentinel). */
struct tn_abi_variant {
  char const * name;         /* ABI variant name */
  uint64_t     tag;          /* enum: tag value; size-discriminated union / union: variant index */
  uint64_t     payload_size; /* payload bytes, UINT64_MAX when variable */
  char const * payload_type; /* ABI type name of the payload */
};
typedef struct tn_abi_variant tn_abi_variant_t;

/* Params metadata: one table per named type (<Type>_param_keys,
   <Type>_PARAM_KEY_CNT entries plus a NULL-member sentinel). */
struct tn_abi_param_key {
  char const * member; /* member path inside <Type>_params_t, e.g. "body.tag" */
  char const * path;   /* ABI path of the value, e.g. "body.tag" */
  uint64_t     offset; /* byte offset of the uint64_t member inside <Type>_params_t */
  int          input;  /* 1: caller supplies it; 0: derived from another member */
};
typedef struct tn_abi_param_key tn_abi_param_key_t;

#endif /* TN_ABI_C_RUNTIME_DEFS */

"#;

/// Static helpers at the top of every generated `functions.c`. On-chain
/// friendly: no allocation, no stdio, no assert.
pub const SOURCE_RUNTIME: &str = r#"/* Internal helpers may go unused in a given package. */
#define TN_ABI_STATIC static inline __attribute__((unused))

/* Checked arithmetic and little-endian load helpers. */
TN_ABI_STATIC int tn_checked_add_u64( uint64_t a, uint64_t b, uint64_t * out ) {
  if( !out ) return 1;
  if( a>UINT64_MAX-b ) return 1;
  *out = a+b;
  return 0;
}

TN_ABI_STATIC int tn_checked_sub_u64( uint64_t a, uint64_t b, uint64_t * out ) {
  if( !out ) return 1;
  if( b>a ) return 1;
  *out = a-b;
  return 0;
}

TN_ABI_STATIC int tn_checked_mul_u64( uint64_t a, uint64_t b, uint64_t * out ) {
  if( !out ) return 1;
  if( a && b>UINT64_MAX/a ) return 1;
  *out = a*b;
  return 0;
}

TN_ABI_STATIC int tn_checked_pow_u64( uint64_t base, uint64_t exp, uint64_t * out ) {
  uint64_t acc = 1UL;
  if( !out ) return 1;
  for( uint64_t i=0UL; i<exp; i++ ) {
    if( tn_checked_mul_u64( acc, base, &acc ) ) return 1;
    if( acc==0UL || acc==1UL ) break;
  }
  *out = acc;
  return 0;
}

TN_ABI_STATIC int tn_checked_shl_u64( uint64_t a, uint64_t b, uint64_t * out ) {
  if( !out ) return 1;
  if( !a ) { *out = 0UL; return 0; }
  if( b>=64UL ) return 1;
  if( b && ( a>>( 64UL-b ) ) ) return 1;
  *out = a<<b;
  return 0;
}

TN_ABI_STATIC int tn_checked_align_up_u64( uint64_t a, uint64_t align, uint64_t * out ) {
  if( !out ) return 1;
  if( align<=1UL ) { *out = a; return 0; }
  uint64_t rem = a%align;
  if( !rem ) { *out = a; return 0; }
  return tn_checked_add_u64( a, align-rem, out );
}

TN_ABI_STATIC uint64_t tn_popcount_u64( uint64_t x ) {
  uint64_t n = 0UL;
  while( x ) { x &= x-1UL; n++; }
  return n;
}

TN_ABI_STATIC void tn_abi_st_u8 ( uint8_t * p, uint64_t v ) { p[0] = (uint8_t)v; }
TN_ABI_STATIC void tn_abi_st_u16( uint8_t * p, uint64_t v ) { uint16_t x = (uint16_t)v; memcpy( p, &x, sizeof x ); }
TN_ABI_STATIC void tn_abi_st_u32( uint8_t * p, uint64_t v ) { uint32_t x = (uint32_t)v; memcpy( p, &x, sizeof x ); }
TN_ABI_STATIC void tn_abi_st_u64( uint8_t * p, uint64_t v ) { memcpy( p, &v, sizeof v ); }

/* Start and length of a child value at byte `off` of a parent walked in
   `mode`. MEASURE may walk past the bytes present: a child that starts past
   the end sees zero bytes (and fails as soon as it needs to read one). */
TN_ABI_STATIC uint8_t const * tn_abi_child_data( uint8_t const * data, uint64_t len, uint64_t off, int mode ) {
  if( mode==TN_ABI_MODE_PARAMS ) return NULL;
  if( mode==TN_ABI_MODE_MEASURE && off>len ) return data;
  return data+off;
}

TN_ABI_STATIC uint64_t tn_abi_child_len( uint64_t len, uint64_t off, int mode ) {
  if( mode==TN_ABI_MODE_VALIDATE ) return len-off;
  if( mode==TN_ABI_MODE_MEASURE ) return off<len ? len-off : 0UL;
  return UINT64_MAX;
}

TN_ABI_STATIC tn_abi_variant_t const * tn_abi_variant_find( tn_abi_variant_t const * tbl, uint64_t cnt, char const * name ) {
  if( !name ) return NULL;
  for( uint64_t i=0UL; i<cnt; i++ ) if( !strcmp( tbl[i].name, name ) ) return &tbl[i];
  return NULL;
}

TN_ABI_STATIC uint64_t tn_abi_ld_u8 ( uint8_t const * p ) { return (uint64_t)p[0]; }
TN_ABI_STATIC uint64_t tn_abi_ld_u16( uint8_t const * p ) { uint16_t v; memcpy( &v, p, sizeof v ); return (uint64_t)v; }
TN_ABI_STATIC uint64_t tn_abi_ld_u32( uint8_t const * p ) { uint32_t v; memcpy( &v, p, sizeof v ); return (uint64_t)v; }
TN_ABI_STATIC uint64_t tn_abi_ld_u64( uint8_t const * p ) { uint64_t v; memcpy( &v, p, sizeof v ); return v; }
TN_ABI_STATIC uint64_t tn_abi_ld_i8 ( uint8_t const * p ) { int8_t  v; memcpy( &v, p, sizeof v ); return (uint64_t)(int64_t)v; }
TN_ABI_STATIC uint64_t tn_abi_ld_i16( uint8_t const * p ) { int16_t v; memcpy( &v, p, sizeof v ); return (uint64_t)(int64_t)v; }
TN_ABI_STATIC uint64_t tn_abi_ld_i32( uint8_t const * p ) { int32_t v; memcpy( &v, p, sizeof v ); return (uint64_t)(int64_t)v; }
TN_ABI_STATIC uint64_t tn_abi_ld_i64( uint8_t const * p ) { int64_t v; memcpy( &v, p, sizeof v ); return (uint64_t)v; }

"#;
