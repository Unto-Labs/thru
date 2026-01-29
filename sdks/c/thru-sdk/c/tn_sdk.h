#ifndef HEADER_tn_src_thru_programs_sdk_tn_sdk_h
#define HEADER_tn_src_thru_programs_sdk_tn_sdk_h

#include "tn_sdk_base.h"
#include "tn_sdk_txn.h"
#include "tn_sdk_types.h"

/* TODO: macro for syscall code */

#define TSDK_ENTRYPOINT_FN __attribute__((section(".text.start"), noreturn))

#define TSDK_SUCCESS (0UL)

#define TSDK_STACK_SEGMENT (0x050000000000UL)

#define TSDK_SEG_TYPE_READONLY_DATA (0x00UL)
#define TSDK_SEG_TYPE_ACCOUNT_METADATA (0x02UL)
#define TSDK_SEG_TYPE_ACCOUNT_DATA (0x03UL)
#define TSDK_SEG_TYPE_STACK (0x05UL)
#define TSDK_SEG_TYPE_HEAP (0x07UL)

#define TSDK_SEG_IDX_NULL (0x0000UL)
#define TSDK_SEG_IDX_TXN_DATA (0x0001UL)
#define TSDK_SEG_IDX_SHADOW_STACK (0x0002UL)
#define TSDK_SEG_IDX_PROGRAM (0x0003UL)
#define TSDK_SEG_IDX_BLOCK_CTX (0x0004UL)

#define TSDK_BLOCK_CTX_VM_SPACING (0x1000UL)

#define TSDK_ADDR( seg_type, seg_idx, offset ) \
  (seg_type << 40UL | seg_idx << 24UL | offset)

#define TSDK_ASSERT_OR_REVERT( cond, error_code ) \
  do {                                            \
    if (!(cond)) {                                \
      tsdk_revert((error_code));                  \
    }                                             \
  } while (0)

#define TSDK_ACCOUNT_DATA_SZ_MAX \
  (16UL * 1024UL * 1024UL) /* Max account data size (excluding metadata) */

#define TSDK_ACCOUNT_FLAG_PROGRAM ((uchar)0x01U)
#define TSDK_ACCOUNT_FLAG_PRIVILEGED ((uchar)0x02U)
#define TSDK_ACCOUNT_FLAG_UNCOMPRESSABLE ((uchar)0x04U)
#define TSDK_ACCOUNT_FLAG_EPHEMERAL ((uchar)0x08U)
#define TSDK_ACCOUNT_FLAG_DELETED ((uchar)0x10U)
#define TSDK_ACCOUNT_FLAG_NEW ((uchar)0x20U)
#define TSDK_ACCOUNT_FLAG_COMPRESSED ((uchar)0x40U)

#define TN_SEED_SIZE (32UL)

/* TSDK_LOAD( T, src ) safely loads a value of type T from potentially
   unaligned memory location src. This macro provides safe access to
   unaligned memory without causing undefined behavior.

   Equivalent to: return (*(T const *)(src))
   but src can have arbitrary alignment.

   Uses memcpy internally which the compiler will typically optimize
   to direct memory access on platforms supporting unaligned access.

   Example: uint value = TSDK_LOAD( uint, unaligned_ptr ); */

#define TSDK_LOAD( T, src )                              \
  (__extension__({                                       \
    T _tsdk_load_tmp;                                    \
    memcpy(&_tsdk_load_tmp, (T const*)(src), sizeof(T)); \
    _tsdk_load_tmp;                                      \
  }))

/* TSDK_STORE( T, dst, val ) safely stores val of type T to potentially
   unaligned memory location dst. This macro provides safe access to
   unaligned memory without causing undefined behavior.

   Equivalent to:
     T * ptr = (T *)(dst);
     *ptr = (val);
     return ptr
   but dst can have arbitrary alignment.

   Uses memcpy internally which the compiler will typically optimize
   to direct memory access on platforms supporting unaligned access.

   Example: TSDK_STORE( ulong, unaligned_dest, 0x123456789abcdefUL ); */

#define TSDK_STORE( T, dst, val )                       \
  (__extension__({                                      \
    T _tsdk_store_tmp = (val);                          \
    (T*)memcpy((T*)(dst), &_tsdk_store_tmp, sizeof(T)); \
  }))

TSDK_PROTOTYPES_BEGIN

/* These prototypes are only needed in freestanding (VM) builds.
   When building for host testing, string.h provides these and
   declaring them again conflicts with builtin declarations on macOS. */
#if defined( __riscv ) || !defined( __STDC_HOSTED__ ) || __STDC_HOSTED__ == 0
void * memset( void * dest, int c, ulong n );

void * memcpy( void * dest, void const * src, ulong n );

int memcmp( void const * s1, void const * s2, ulong n );
#endif

static inline void *
tsdk_type_pun( void * p ) {
  __asm__ ( "# tsdk_type_pun @" TSDK_SRC_LOCATION: "+r" ( p ) :: "memory" );
  return p;
}

static inline void const *
tsdk_type_pun_const( void const * p ) {
  __asm__ ( "# tsdk_type_pun_const @" TSDK_SRC_LOCATION: "+r" ( p ) :: "memory" );
  return p;
}

tsdk_account_meta_t const * tsdk_get_account_meta( ushort account_idx );

void * tsdk_get_account_data_ptr( ushort account_idx );

int tsdk_account_exists( ushort account_idx );

tsdk_txn_t const * tsdk_get_txn( void );

tsdk_block_ctx_t const * tsdk_get_current_block_ctx( void );

tsdk_block_ctx_t const * tsdk_get_past_block_ctx( ulong blocks_in_past );

tsdk_shadow_stack_t const * tsdk_get_shadow_stack( void );

void __attribute__(( noreturn )) tsdk_revert( ulong error_code );

void __attribute__(( noreturn )) tsdk_return( ulong return_code );

void __attribute__(( format( printf, 1, 2 ))) tsdk_printf( char const * fmt, ... );

int tsdk_is_account_authorized_by_idx( ushort account_idx );

int tsdk_is_account_authorized_by_pubkey( tn_pubkey_t const * pubkey );

ushort tsdk_get_current_program_acc_idx( void );

tn_pubkey_t const * tsdk_get_current_program_acc_addr( void );

int tsdk_is_account_idx_valid( ushort account_idx );

/* Checks if the account at the given index is owned by the currently
   executing program. Requires that `account_idx` is valid. */

int tsdk_is_account_owned_by_current_program( ushort account_idx );

/* Checks if the current program is already in the shadow stack (i.e.,
   has been invoked recursively). Returns 1 if the program is reentrant,
   0 otherwise. */

int tsdk_is_program_reentrant( void );

tn_pubkey_t * tsdk_create_program_defined_account_address(
  tn_pubkey_t const * owner, uchar is_ephemeral,
  uchar const seed[TN_SEED_SIZE], tn_pubkey_t * out_pubkey );

TSDK_PROTOTYPES_END

#endif /* HEADER_tn_src_thru_programs_sdk_tn_sdk_h */

