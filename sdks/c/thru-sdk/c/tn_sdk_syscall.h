#ifndef HEADER_tn_src_thru_programs_sdk_tn_sdk_syscall_h
#define HEADER_tn_src_thru_programs_sdk_tn_sdk_syscall_h

#include "tn_sdk.h"

/* FIXME: CONSIDER MOVING TO TN_VM_SYSCALL.H */
#define TN_SYSCALL_CODE_SET_ANONYMOUS_SEGMENT_SZ (0x00UL)
#define TN_SYSCALL_CODE_INCREMENT_ANONYMOUS_SEGMENT_SZ (0x01UL)
#define TN_SYSCALL_CODE_SET_ACCOUNT_DATA_WRITABLE (0x02UL)
#define TN_SYSCALL_CODE_ACCOUNT_TRANSFER (0x03UL)
#define TN_SYSCALL_CODE_ACCOUNT_CREATE (0x04UL)
#define TN_SYSCALL_CODE_ACCOUNT_CREATE_EPHEMERAL (0x05UL)
#define TN_SYSCALL_CODE_ACCOUNT_DELETE (0x06UL)
#define TN_SYSCALL_CODE_ACCOUNT_RESIZE (0x07UL)
#define TN_SYSCALL_CODE_ACCOUNT_COMPRESS (0x08UL)
#define TN_SYSCALL_CODE_ACCOUNT_DECOMPRESS (0x09UL)
#define TN_SYSCALL_CODE_INVOKE (0x0AUL)
#define TN_SYSCALL_CODE_EXIT (0x0BUL)
#define TN_SYSCALL_CODE_LOG (0x0CUL)
#define TN_SYSCALL_CODE_EMIT_EVENT (0x0DUL)
#define TN_SYSCALL_CODE_ACCOUNT_SET_FLAGS (0x0EUL)
#define TN_SYSCALL_CODE_ACCOUNT_CREATE_EOA (0x0FUL)

TSDK_PROTOTYPES_BEGIN

ulong tsys_set_account_data_writable(ulong account_idx);

ulong tsys_account_transfer(ulong from_account_idx, ulong to_account_idx,
                            ulong amount);

/* TODO need a method for looking up the call shadow stack to find if an account
 * idx is authorized */

ulong tsys_set_anonymous_segment_sz(void* addr);

ulong tsys_increment_anonymous_segment_sz(void* segment_addr, ulong delta,
                                          void** addr);

ulong tsys_account_create(ulong account_idx, uchar const seed[TN_SEED_SIZE],
                          void const* proof, ulong proof_sz);

ulong tsys_account_create_ephemeral(ulong account_idx, uchar const seed[TN_SEED_SIZE]);

ulong tsys_account_delete(ulong account_idx);

ulong tsys_account_resize(ulong account_idx, ulong new_size);

ulong tsys_account_compress(ulong account_idx, void const* proof, ulong proof_sz);
ulong tsys_account_decompress(ulong account_idx, void const* meta, void const* data,
                              void const* proof, ulong proof_sz);

ulong tsys_invoke(void const* instr_data, ulong instr_data_sz,
                  ushort program_account_idx, ulong* invoke_err_code);

ulong __attribute__((noreturn)) tsys_exit(ulong exit_code, ulong revert);

ulong tsys_log(void const* data, ulong data_len);

ulong tsys_emit_event(void const* data, ulong data_sz);

ulong tsys_account_set_flags(ushort account_idx, uchar flags);

ulong tsys_account_create_eoa(ulong account_idx,
                              tn_signature_t const * signature,
                              void const* proof,
                              ulong proof_sz);

TSDK_PROTOTYPES_END

#endif /* HEADER_tn_src_thru_programs_sdk_tn_sdk_syscall_h */
