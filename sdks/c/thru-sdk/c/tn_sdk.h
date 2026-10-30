#ifndef HEADER_tn_src_thru_programs_sdk_tn_sdk_h
#define HEADER_tn_src_thru_programs_sdk_tn_sdk_h

#include "tn_sdk_base.h"
#include "tn_sdk_txn.h"
#include "tn_sdk_types.h"
#include "tn_sdk_programs.h"

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
/* Opt in to native credits; this grants no authority to spend the balance. */
#define TSDK_ACCOUNT_FLAG_RECEIVE_NATIVE ((uchar)0x80U)

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

/* Sentinel returned by tsdk_get_caller_program_acc_idx when there is no
   caller frame (the program was invoked at the top level). */
#define TSDK_CALLER_PROGRAM_NONE ((ushort)0xFFFFU)

/* tsdk_get_caller_program_acc_idx returns the program account index of
   the immediate caller's frame (call_depth - 1) — i.e. the program that
   issued the cross-program invocation into the currently executing
   program.  Returns TSDK_CALLER_PROGRAM_NONE when invoked at the top
   level (call_depth < 2), where there is no caller program.  Unlike
   tsdk_is_account_authorized_by_pubkey (which walks every parent frame),
   this inspects ONLY the immediate caller — the right primitive for an
   "only X may call me directly" check. */

ushort tsdk_get_caller_program_acc_idx( void );

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

/* Invoke-target authentication (UNTO-2328 / VERIA-1).

   The runtime reports an invoke as successful whenever the callee returns
   0; it has no notion of what the callee was supposed to do.  A program
   that takes "the token program's account index" from its instruction
   data and passes it straight to tsys_invoke therefore lets the
   transaction author substitute any executable (the no-op program will
   do) and have the burn / transfer / mint reported as done while no token
   moves.  Every caller-supplied index of a well-known program must be
   gated through tsdk_is_program_at_idx (or one of its wrappers) before it
   reaches tsys_invoke.

   tsdk_is_program_at_idx returns 1 iff account_idx is a valid index into
   the transaction's account list, the account exists, carries
   TSDK_ACCOUNT_FLAG_PROGRAM and its address equals expected; 0 otherwise.

   The address compare is four aligned word loads.  The transaction's
   account address table starts at byte 48 of the 8-byte aligned
   transaction segment and every entry is 32 bytes, so each entry is
   8-byte aligned; expected must be 8-byte aligned too (tsdk_program_addr_t
   guarantees it).  tn_pubkey_t is packed, so comparing through it (or
   through the SDK's byte-loop memcmp) would cost an order of magnitude
   more compute per gate. */

typedef union {
  uchar uc[ 32 ];
  ulong ul[ 4 ];
} tsdk_program_addr_t;

typedef ulong __attribute__(( may_alias )) tsdk_addr_word_t;

static inline int
tsdk_is_program_at_idx( ushort                      account_idx,
                        tsdk_program_addr_t const * expected ) {
  tsdk_txn_t const * txn = tsdk_get_txn( );
  if( account_idx >= tsdk_txn_account_cnt( txn ) ) return 0;
  tsdk_account_meta_t const * meta = tsdk_get_account_meta( account_idx );
  if( meta->version == 0 || !( meta->flags & TSDK_ACCOUNT_FLAG_PROGRAM ) ) return 0;
  tsdk_addr_word_t const * addr =
    (tsdk_addr_word_t const *)__builtin_assume_aligned( tsdk_txn_get_acct_addrs( txn ) + account_idx, 8 );
  return ( ( addr[0] ^ expected->ul[0] ) | ( addr[1] ^ expected->ul[1] ) |
           ( addr[2] ^ expected->ul[2] ) | ( addr[3] ^ expected->ul[3] ) ) == 0UL;
}

/* tsdk_is_token_program_idx returns 1 iff account_idx names the canonical
   token program (TSDK_TOKEN_PROGRAM_ADDR_BYTES). */

static inline int
tsdk_is_token_program_idx( ushort account_idx ) {
  static tsdk_program_addr_t const addr = { .uc = TSDK_TOKEN_PROGRAM_ADDR_BYTES };
  return tsdk_is_program_at_idx( account_idx, &addr );
}

/* tsdk_is_block_producer_program_idx returns 1 iff account_idx names the
   canonical block-producer bond program
   (TSDK_BLOCK_PRODUCER_PROGRAM_ADDR_BYTES). */

static inline int
tsdk_is_block_producer_program_idx( ushort account_idx ) {
  static tsdk_program_addr_t const addr = { .uc = TSDK_BLOCK_PRODUCER_PROGRAM_ADDR_BYTES };
  return tsdk_is_program_at_idx( account_idx, &addr );
}

/* tsdk_is_name_service_program_idx returns 1 iff account_idx names the
   canonical name-service program (TSDK_NAME_SERVICE_PROGRAM_ADDR_BYTES). */

static inline int
tsdk_is_name_service_program_idx( ushort account_idx ) {
  static tsdk_program_addr_t const addr = { .uc = TSDK_NAME_SERVICE_PROGRAM_ADDR_BYTES };
  return tsdk_is_program_at_idx( account_idx, &addr );
}

TSDK_PROTOTYPES_END

#endif /* HEADER_tn_src_thru_programs_sdk_tn_sdk_h */
