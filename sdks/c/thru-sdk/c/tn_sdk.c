#include "tn_sdk.h"
#include "tn_sdk_base.h"
#include "tn_sdk_syscall.h"
#include "tn_sdk_sha256.h"
#include "tn_sdk_txn.h"

#include <stdarg.h>
#include <stdio.h>
#include <string.h>

void* memset(void* dest, int c, ulong n) {
  uchar* p = (uchar*)dest;
  while (n--)
    *p++ = (uchar)c;
  return dest;
}

void* memcpy(void* dest, void const* src, ulong n) {
  uchar* d = (uchar*)dest;
  uchar const* s = (uchar const*)src;
  while (n--)
    *d++ = *s++;
  return dest;
}

int memcmp(void const* s1, void const* s2, ulong n) {
  uchar const* p1 = (uchar const*)s1;
  uchar const* p2 = (uchar const*)s2;
  while (n--) {
    if (*p1 != *p2)
      return *p1 - *p2;
  }
  return 0;
}

tsdk_txn_t const* tsdk_get_txn(void) {
  return (tsdk_txn_t const*)TSDK_ADDR(TSDK_SEG_TYPE_READONLY_DATA,
                                    TSDK_SEG_IDX_TXN_DATA, 0UL);
}

tsdk_block_ctx_t const* tsdk_get_current_block_ctx(void) {
  return (tsdk_block_ctx_t const*)TSDK_ADDR(TSDK_SEG_TYPE_READONLY_DATA,
                                          TSDK_SEG_IDX_BLOCK_CTX, 0UL);
}

tsdk_block_ctx_t const* tsdk_get_past_block_ctx(ulong blocks_in_past) {
  return (tsdk_block_ctx_t const*)TSDK_ADDR(
      TSDK_SEG_TYPE_READONLY_DATA, TSDK_SEG_IDX_BLOCK_CTX,
      blocks_in_past * TSDK_BLOCK_CTX_VM_SPACING);
}

int tsdk_is_account_idx_valid(ushort account_idx) {
  return account_idx < tsdk_txn_account_cnt(tsdk_get_txn());
}

tsdk_account_meta_t const* tsdk_get_account_meta(ushort account_idx) {
  return (tsdk_account_meta_t const*)TSDK_ADDR(TSDK_SEG_TYPE_ACCOUNT_METADATA,
                                               (ulong)account_idx, 0UL);
}

void* tsdk_get_account_data_ptr(ushort account_idx) {
  return (void*)TSDK_ADDR(TSDK_SEG_TYPE_ACCOUNT_DATA, (ulong)account_idx, 0UL);
}

tsdk_shadow_stack_t const* tsdk_get_shadow_stack(void) {
  return (tsdk_shadow_stack_t const*)TSDK_ADDR(TSDK_SEG_TYPE_READONLY_DATA,
                                               TSDK_SEG_IDX_SHADOW_STACK, 0UL);
}

ulong tsdk_set_stack_sz(ulong sz) {
  ulong res = tsys_set_anonymous_segment_sz((uchar*)TSDK_STACK_SEGMENT + sz);
  if (TSDK_UNLIKELY(res != TSDK_SUCCESS)) {
    return res;
  }

  ulong stack_vaddr = TSDK_STACK_SEGMENT;
  __asm__("move sp, %0"
          : /* no output */
          : "r"(stack_vaddr + sz)
          : "memory");

  return TSDK_SUCCESS;
}

void __attribute__((noreturn)) tsdk_revert(ulong error_code) {
  tsys_exit(error_code, 1UL);
  __builtin_unreachable();
}

void __attribute__((noreturn)) tsdk_return(ulong return_code) {
  tsys_exit(return_code, 0UL);
  __builtin_unreachable();
}

void __attribute__((format(printf, 1, 2))) tsdk_printf(char const* fmt, ...) {
  char buf[1024];
  va_list args;
  va_start(args, fmt);
  int err = vsnprintf(buf, sizeof(buf), fmt, args);
  va_end(args);
  if (err < 0) {
    tsys_log("tsdk_printf: formatting error", 28);
    return;
  }
  if (err >= (int)sizeof(buf)) {
    tsys_log(buf, sizeof(buf) - 1);
  } else {
    tsys_log(buf, (ulong)err);
  }
}

int tsdk_is_account_authorized_by_idx(ushort account_idx) {
  /* If account is the fee payer, it has authorized */
  if (account_idx == 0) {
    return 1;
  }

  /* If account is the current program, this program has authorized */
  tsdk_shadow_stack_t const* shadow_stack = tsdk_get_shadow_stack();
  if (shadow_stack->current_program_acc_idx == account_idx) {
    return 1;
  }

  /* If there are no called program invocations by this point, the account is
     not authorized. This is an optimization to avoid the loop below. */
  if (shadow_stack->call_depth == 0) {
    return 0;
  }

  /* If account is in the chain of program invocations, that program has
     authorized. */
  for (ushort i = shadow_stack->call_depth; i > 0; i--) {
    tsdk_shadow_stack_frame_t const* frame = &shadow_stack->stack_frames[i - 1];
    if (frame->program_acc_idx == account_idx) {
      return 1;
    }
  }

  return 0;
}

int tsdk_is_account_authorized_by_pubkey(tn_pubkey_t const* pubkey) {
  tn_pubkey_t const* accs = tsdk_txn_get_acct_addrs(tsdk_get_txn());

  /* If account is the fee payer, it has authorized */
  if (memcmp(pubkey, &accs[0], sizeof(tn_pubkey_t)) == 0) {
    return 1;
  }

  /* If account is the current program, this program has authorized */
  tsdk_shadow_stack_t const* shadow_stack = tsdk_get_shadow_stack();
  if (memcmp(pubkey, &accs[shadow_stack->current_program_acc_idx],
             sizeof(tn_pubkey_t)) == 0) {
    return 1;
  }

  /* If there are no called program invocations by this point, the account is
     not authorized. This is an optimization to avoid the loop below. */
  if (shadow_stack->call_depth == 0) {
    return 0;
  }

  /* If account is in the chain of program invocations, that program has
     authorized. */
  for (ushort i = shadow_stack->call_depth; i > 0; i--) {
    tsdk_shadow_stack_frame_t const* frame = &shadow_stack->stack_frames[i - 1];
    if (memcmp(pubkey, &accs[frame->program_acc_idx], sizeof(tn_pubkey_t)) == 0) {
      return 1;
    }
  }

  return 0;
}

ushort tsdk_get_current_program_acc_idx(void) {
  tsdk_shadow_stack_t const* shadow_stack = tsdk_get_shadow_stack();
  return shadow_stack->current_program_acc_idx;
}

tn_pubkey_t const* tsdk_get_current_program_acc_addr(void) {
  return &tsdk_txn_get_acct_addrs(tsdk_get_txn())[tsdk_get_current_program_acc_idx()];
}

int tsdk_is_account_owned_by_current_program(ushort account_idx) {
  tsdk_account_meta_t const* account_meta = tsdk_get_account_meta(account_idx);
  return memcmp(tsdk_get_current_program_acc_addr(), &account_meta->owner, sizeof(tn_pubkey_t)) == 0;
}

int tsdk_is_program_reentrant(void) {
  tsdk_shadow_stack_t const* shadow_stack = tsdk_get_shadow_stack();
  ushort current_program_idx = shadow_stack->current_program_acc_idx;

  /* If there are no previous invocations, the program is not reentrant */
  if (shadow_stack->call_depth == 0) {
    return 0;
  }

  /* Check if the current program appears in any previous stack frame */
  for (ushort i = 0; i < shadow_stack->call_depth; i++) {
    tsdk_shadow_stack_frame_t const* frame = &shadow_stack->stack_frames[i];
    if (frame->program_acc_idx == current_program_idx) {
      return 1;
    }
  }

  return 0;
}

int tsdk_account_exists(ushort account_idx) {
  tsdk_account_meta_t const* account_meta = tsdk_get_account_meta(account_idx);
  return account_meta->version == TN_ACCOUNT_V1;
}

tn_pubkey_t *
tsdk_create_program_defined_account_address( tn_pubkey_t const * owner,
                                             uchar          is_ephemeral,
                                             uchar const    seed[TN_SEED_SIZE],
                                             tn_pubkey_t *  out_pubkey ) {
  tsdk_sha256_t sha;
  tsdk_sha256_init( &sha );
  tsdk_sha256_append( &sha, owner, sizeof(tn_pubkey_t) );
  tsdk_sha256_append( &sha, &is_ephemeral, sizeof(uchar) );
  tsdk_sha256_append( &sha, seed, TN_SEED_SIZE );
  tsdk_sha256_fini( &sha, out_pubkey );

  return out_pubkey;
}
