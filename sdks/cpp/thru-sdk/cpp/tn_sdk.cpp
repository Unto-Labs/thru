#include "tn_sdk.hpp"
#include "tn_sdk_syscall.hpp"

#include <cstdarg>
#include <cstdio>
#include <cstring>

// C-compatible SDK functions
extern "C" {

const tn_txn* tsdk_get_txn(void) {
  return reinterpret_cast<const tn_txn*>(
      thru::mem::segment_address(TSDK_SEG_TYPE_READONLY_DATA, TSDK_SEG_IDX_TXN_DATA, 0UL));
}

const tn_block_ctx* tsdk_get_current_block_ctx(void) {
  return reinterpret_cast<tn_block_ctx const*>(
      thru::mem::segment_address(TSDK_SEG_TYPE_READONLY_DATA, TSDK_SEG_IDX_BLOCK_CTX, 0UL));
}

const tn_block_ctx* tsdk_get_past_block_ctx(ulong blocks_in_past) {
  return reinterpret_cast<tn_block_ctx const*>(
      thru::mem::segment_address(TSDK_SEG_TYPE_READONLY_DATA, TSDK_SEG_IDX_BLOCK_CTX,
                                 blocks_in_past * TSDK_BLOCK_CTX_VM_SPACING));
}

int tsdk_is_account_idx_valid(ushort account_idx) {
  return account_idx < tn_txn_account_cnt(tsdk_get_txn());
}

const tn_account_meta* tsdk_get_account_meta(ushort account_idx) {
  return reinterpret_cast<const tn_account_meta*>(
      thru::mem::segment_address(TSDK_SEG_TYPE_ACCOUNT_METADATA, account_idx, 0UL));
}

void* tsdk_get_account_data_ptr(ushort account_idx) {
  return reinterpret_cast<void*>(
      thru::mem::segment_address(TSDK_SEG_TYPE_ACCOUNT_DATA, account_idx, 0UL));
}

const tsdk_shadow_stack* tsdk_get_shadow_stack(void) {
  return reinterpret_cast<const tsdk_shadow_stack*>(
      thru::mem::segment_address(TSDK_SEG_TYPE_READONLY_DATA, TSDK_SEG_IDX_SHADOW_STACK, 0UL));
}

[[noreturn]] void tsdk_revert(ulong error_code) {
  tsys_exit(error_code, 1UL);
  __builtin_unreachable();
}

[[noreturn]] void tsdk_return(ulong return_code) {
  tsys_exit(return_code, 0UL);
  __builtin_unreachable();
}

void tsdk_printf(const char* fmt, ...) {
  char buf[1024];
  va_list args;
  va_start(args, fmt);
  int err = vsnprintf(buf, sizeof(buf), fmt, args);
  va_end(args);
  tsys_log(buf, static_cast<ulong>(err));
}

int tsdk_is_account_authorized_by_idx(ushort account_idx) {
  // If account is the fee payer, it has authorized
  if (account_idx == 0) {
    return 1;
  }

  // If account is the current program, this program has authorized
  const tsdk_shadow_stack* shadow_stack = tsdk_get_shadow_stack();
  ushort current_program_acc_idx = shadow_stack->stack_frames[shadow_stack->call_depth].program_acc_idx;
  if (current_program_acc_idx == account_idx) {
    return 1;
  }

  // If there are no called program invocations by this point, the account is
  // not authorized. This is an optimization to avoid the loop below.
  if (shadow_stack->call_depth == 1) {
    return 0;
  }

  // If account is in the chain of program invocations, that program has
  // authorized.
  for (ushort i = shadow_stack->call_depth - 1; i > 0; i--) {
    const tsdk_shadow_stack_frame* frame = &shadow_stack->stack_frames[i];
    if (frame->program_acc_idx == account_idx) {
      return 1;
    }
  }

  return 0;
}

int tsdk_is_account_authorized_by_pubkey(const pubkey_t* pubkey) {
  const pubkey_t* accs = tn_txn_get_acct_addrs(tsdk_get_txn());

  // If account is the fee payer, it has authorized
  if (std::memcmp(pubkey->key.data(), accs[0].key.data(), sizeof(pubkey_t)) ==
      0) {
    return 1;
  }

  // If account is the current program, this program has authorized
  const tsdk_shadow_stack* shadow_stack = tsdk_get_shadow_stack();
  ushort current_program_acc_idx = shadow_stack->stack_frames[shadow_stack->call_depth].program_acc_idx;
  if (std::memcmp(pubkey->key.data(),
                  accs[current_program_acc_idx].key.data(),
                  sizeof(pubkey_t)) == 0) {
    return 1;
  }

  // If there are no called program invocations by this point, the account is
  // not authorized. This is an optimization to avoid the loop below.
  if (shadow_stack->call_depth == 1) {
    return 0;
  }

  // If account is in the chain of program invocations, that program has
  // authorized.
  for (ushort i = shadow_stack->call_depth - 1; i > 0; i--) {
    const tsdk_shadow_stack_frame* frame = &shadow_stack->stack_frames[i];
    if (std::memcmp(pubkey->key.data(), accs[frame->program_acc_idx].key.data(),
                    sizeof(pubkey_t)) == 0) {
      return 1;
    }
  }

  return 0;
}

ushort tsdk_get_current_program_acc_idx(void) {
  const tsdk_shadow_stack* shadow_stack = tsdk_get_shadow_stack();
  return shadow_stack->stack_frames[shadow_stack->call_depth].program_acc_idx;
}

const pubkey_t* tsdk_get_current_program_acc_addr(void) {
  return &tn_txn_get_acct_addrs(tsdk_get_txn())[tsdk_get_current_program_acc_idx()];
}

int tsdk_is_account_owned_by_current_program(ushort account_idx) {
  const tn_account_meta* account_meta = tsdk_get_account_meta(account_idx);
  return std::memcmp(tsdk_get_current_program_acc_addr(), &account_meta->owner, sizeof(pubkey_t)) == 0;
}

int tsdk_is_program_reentrant(void) {
  const tsdk_shadow_stack* shadow_stack = tsdk_get_shadow_stack();
  ushort current_program_idx = shadow_stack->stack_frames[shadow_stack->call_depth].program_acc_idx;

  /* If there are no previous invocations, the program is not reentrant */
  if (shadow_stack->call_depth == 1) {
    return 0;
  }

  /* Check if the current program appears in any previous stack frame */
  for (ushort i = shadow_stack->call_depth - 1; i > 0; i--) {
    const tsdk_shadow_stack_frame* frame = &shadow_stack->stack_frames[i];
    if (frame->program_acc_idx == current_program_idx) {
      return 1;
    }
  }

  return 0;
}

int tsdk_account_exists(ushort account_idx) {
  const tn_account_meta* account_meta = tsdk_get_account_meta(account_idx);
  return account_meta->version == TN_ACCOUNT_V1;
}

} // extern "C"
