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
  /* Fee payer is always authorized */
  if (account_idx == 0) {
    return 1;
  }

  const tsdk_shadow_stack* shadow_stack = tsdk_get_shadow_stack();

  /* Current program is always authorized */
  ushort current_program_acc_idx =
      shadow_stack->stack_frames[shadow_stack->call_depth].program_acc_idx;
  if (current_program_acc_idx == account_idx) {
    return 1;
  }

  /* No parent frames to check */
  if (shadow_stack->call_depth == 1) {
    return 0;
  }

  const pubkey_t* accs = tn_txn_get_acct_addrs(tsdk_get_txn());
  const tn_account_meta* target_meta = tsdk_get_account_meta(account_idx);

  /* Walk shadow stack from most recent parent down to root.
     First match wins - deeper frames override shallower ones. */
  for (ushort i = static_cast<ushort>(shadow_stack->call_depth - 1U); i > 0;
       i--) {
    const tsdk_shadow_stack_frame* frame = &shadow_stack->stack_frames[i];
    ulong auth_ptr = frame->saved_regs[13]; /* a3 register */

    if (auth_ptr != 0UL) {
      const tsdk_invoke_auth_t* auth =
          reinterpret_cast<const tsdk_invoke_auth_t*>(auth_ptr);
      if (auth->magic == TSDK_INVOKE_AUTH_MAGIC) {
        const ushort* deauth = auth->deauth_idxs();
        for (ushort j = 0; j < auth->deauth_cnt; j++) {
          if (deauth[j] == account_idx) {
            return 0;
          }
        }
        const ushort* auth_idxs = auth->auth_idxs();
        for (ushort j = 0; j < auth->auth_cnt; j++) {
          if (auth_idxs[j] == account_idx) {
            if (std::memcmp(&target_meta->owner, &accs[frame->program_acc_idx],
                            sizeof(pubkey_t)) == 0) {
              return 1;
            }
            tsdk_revert(0xBAD0A174UL); /* auth entry for unowned account */
          }
        }
      }
    }

    /* Existing behavior: program in call chain is authorized */
    if (frame->program_acc_idx == account_idx) {
      return 1;
    }
  }

  return 0;
}

int tsdk_is_account_authorized_by_pubkey(const pubkey_t* pubkey) {
  const pubkey_t* accs = tn_txn_get_acct_addrs(tsdk_get_txn());

  /* Fee payer is always authorized */
  if (std::memcmp(pubkey, &accs[0], sizeof(pubkey_t)) == 0) {
    return 1;
  }

  const tsdk_shadow_stack* shadow_stack = tsdk_get_shadow_stack();

  /* Current program is always authorized */
  ushort current_program_acc_idx =
      shadow_stack->stack_frames[shadow_stack->call_depth].program_acc_idx;
  if (std::memcmp(pubkey, &accs[current_program_acc_idx], sizeof(pubkey_t)) ==
      0) {
    return 1;
  }

  /* No parent frames to check */
  if (shadow_stack->call_depth == 1) {
    return 0;
  }

  /* Walk shadow stack from most recent parent down to root.
     First match wins - deeper frames override shallower ones. */
  for (ushort i = static_cast<ushort>(shadow_stack->call_depth - 1U); i > 0;
       i--) {
    const tsdk_shadow_stack_frame* frame = &shadow_stack->stack_frames[i];
    ulong auth_ptr = frame->saved_regs[13]; /* a3 register */

    if (auth_ptr != 0UL) {
      const tsdk_invoke_auth_t* auth =
          reinterpret_cast<const tsdk_invoke_auth_t*>(auth_ptr);
      if (auth->magic == TSDK_INVOKE_AUTH_MAGIC) {
        const ushort* deauth_idxs = auth->deauth_idxs();
        for (ushort j = 0; j < auth->deauth_cnt; j++) {
          if (std::memcmp(pubkey, &accs[deauth_idxs[j]], sizeof(pubkey_t)) ==
              0) {
            return 0;
          }
        }
        const ushort* auth_idxs = auth->auth_idxs();
        for (ushort j = 0; j < auth->auth_cnt; j++) {
          if (std::memcmp(pubkey, &accs[auth_idxs[j]], sizeof(pubkey_t)) ==
              0) {
            const tn_account_meta* target_meta = tsdk_get_account_meta(auth_idxs[j]);
            if (std::memcmp(&target_meta->owner, &accs[frame->program_acc_idx],
                            sizeof(pubkey_t)) == 0) {
              return 1;
            }
            tsdk_revert(0xBAD0A174UL); /* auth entry for unowned account */
          }
        }
      }
    }

    /* Existing behavior: program in call chain is authorized */
    if (std::memcmp(pubkey, &accs[frame->program_acc_idx], sizeof(pubkey_t)) ==
        0) {
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
