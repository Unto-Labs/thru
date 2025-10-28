#include "tn_sdk_syscall.h"

ulong tsys_set_account_data_writable(ulong account_idx) {
  register ulong a0 __asm__("a0") = account_idx;
  register ulong a7 __asm__("a7") = TN_SYSCALL_CODE_SET_ACCOUNT_DATA_WRITABLE;
  __asm__("ecall" : "+r"(a0) : "r"(a7) : "memory");
  return a0;
}

ulong tsys_account_transfer(ulong from_account_idx, ulong to_account_idx,
                            ulong amount) {
  register ulong a0 __asm__("a0") = from_account_idx;
  register ulong a1 __asm__("a1") = to_account_idx;
  register ulong a2 __asm__("a2") = amount;
  register ulong a7 __asm__("a7") = TN_SYSCALL_CODE_ACCOUNT_TRANSFER;
  __asm__("ecall"
          : "+r"(a0)
          : "r"(a1), "r"(a2), "r"(a7)
          : "memory");
  return a0;
}

/* TODO need a method for looking up the call shadow stack to find if an account
 * idx is authorized */

ulong tsys_set_anonymous_segment_sz(void* addr) {
  register ulong a0 __asm__("a0") = (ulong)addr;
  register ulong a7 __asm__("a7") = TN_SYSCALL_CODE_SET_ANONYMOUS_SEGMENT_SZ;
  __asm__("ecall" : "+r"(a0) : "r"(a7) : "memory");
  return a0;
}

ulong tsys_increment_anonymous_segment_sz(void* segment_addr, ulong delta,
                                          void** addr) {
  register ulong a0 __asm__("a0") = (ulong)segment_addr;
  register ulong a1 __asm__("a1") = delta;
  register ulong a7 __asm__("a7") =
      TN_SYSCALL_CODE_INCREMENT_ANONYMOUS_SEGMENT_SZ;
  __asm__ volatile ("ecall"
          : "+r"(a0), "+r"(a1)
          : "r"(a7)
          : "memory");
  if (addr) {
    *addr = (void *)a1;
  }

  return a0;
}

ulong tsys_account_create(ulong account_idx, uchar const seed[TN_SEED_SIZE],
                          void const* proof, ulong proof_sz) {
  ulong seed_val0, seed_val1, seed_val2, seed_val3;
  memcpy(&seed_val0, &seed[0], sizeof(ulong));
  memcpy(&seed_val1, &seed[8], sizeof(ulong));
  memcpy(&seed_val2, &seed[16], sizeof(ulong));
  memcpy(&seed_val3, &seed[24], sizeof(ulong));
  
  register ulong a0 __asm__("a0") = account_idx;
  register ulong a1 __asm__("a1") = seed_val0;
  register ulong a2 __asm__("a2") = seed_val1;
  register ulong a3 __asm__("a3") = seed_val2;
  register ulong a4 __asm__("a4") = seed_val3;
  register ulong a5 __asm__("a5") = (ulong)proof;
  register ulong a6 __asm__("a6") = proof_sz;
  register ulong a7 __asm__("a7") = TN_SYSCALL_CODE_ACCOUNT_CREATE;
  __asm__("ecall"
          : "+r"(a0)
          : "r"(a1), "r"(a2), "r"(a3), "r"(a4), "r"(a5), "r"(a6), "r"(a7)
          : "memory");
  return a0;
}

ulong tsys_account_create_ephemeral(ulong account_idx, uchar const seed[TN_SEED_SIZE]) {
  ulong seed_val0, seed_val1, seed_val2, seed_val3;
  memcpy(&seed_val0, &seed[0], sizeof(ulong));
  memcpy(&seed_val1, &seed[8], sizeof(ulong));
  memcpy(&seed_val2, &seed[16], sizeof(ulong));
  memcpy(&seed_val3, &seed[24], sizeof(ulong));
  
  register ulong a0 __asm__("a0") = account_idx;
  register ulong a1 __asm__("a1") = seed_val0;
  register ulong a2 __asm__("a2") = seed_val1;
  register ulong a3 __asm__("a3") = seed_val2;
  register ulong a4 __asm__("a4") = seed_val3;
  register ulong a7 __asm__("a7") = TN_SYSCALL_CODE_ACCOUNT_CREATE_EPHEMERAL;
  __asm__("ecall" : "+r"(a0) : "r"(a1), "r"(a2), "r"(a3), "r"(a4), "r"(a7) : "memory");
  return a0;
}

ulong tsys_account_delete(ulong account_idx) {
  register ulong a0 __asm__("a0") = account_idx;
  register ulong a7 __asm__("a7") = TN_SYSCALL_CODE_ACCOUNT_DELETE;
  __asm__("ecall" : "+r"(a0) : "r"(a7) : "memory");
  return a0;
}

ulong tsys_account_resize(ulong account_idx, ulong new_size) {
  register ulong a0 __asm__("a0") = account_idx;
  register ulong a1 __asm__("a1") = new_size;
  register ulong a7 __asm__("a7") = TN_SYSCALL_CODE_ACCOUNT_RESIZE;
  __asm__("ecall" : "+r"(a0) : "r"(a1), "r"(a7) : "memory");
  return a0;
}

ulong tsys_account_compress(ulong account_idx, void const* proof, ulong proof_sz) {
  register ulong a0 __asm__("a0") = account_idx;
  register ulong a1 __asm__("a1") = (ulong)proof;
  register ulong a2 __asm__("a2") = proof_sz;
  register ulong a7 __asm__("a7") = TN_SYSCALL_CODE_ACCOUNT_COMPRESS;
  __asm__("ecall" : "+r"(a0) : "r"(a1), "r"(a2), "r"(a7) : "memory");
  return a0;
}

ulong tsys_account_decompress(ulong account_idx, void const* meta,
                              void const* data, void const* proof, ulong proof_sz) {
  register ulong a0 __asm__("a0") = account_idx;
  register ulong a1 __asm__("a1") = (ulong)meta;
  register ulong a2 __asm__("a2") = (ulong)data;
  register ulong a3 __asm__("a3") = (ulong)proof;
  register ulong a4 __asm__("a4") = proof_sz;
  register ulong a7 __asm__("a7") = TN_SYSCALL_CODE_ACCOUNT_DECOMPRESS;
  __asm__("ecall"
          : "+r"(a0)
          : "r"(a1), "r"(a2), "r"(a3), "r"(a4), "r"(a7)
          : "memory");
  return a0;
}

ulong tsys_invoke(void const* instr_data, ulong instr_data_sz,
                  ushort program_account_idx, ulong* invoke_err_code) {
  register ulong a0 __asm__("a0") = (ulong)instr_data;
  register ulong a1 __asm__("a1") = instr_data_sz;
  register ulong a2 __asm__("a2") = (ulong)program_account_idx;
  register ulong a7 __asm__("a7") = TN_SYSCALL_CODE_INVOKE;
  __asm__("ecall"
          : "+r"(a0), "+r"(a1)
          : "r"(a2), "r"(a7)
          : "ra", "memory");
  if (invoke_err_code) *invoke_err_code = a1;
  return a0;
}

ulong __attribute__((noreturn)) tsys_exit(ulong exit_code, ulong revert) {
  register ulong a0 __asm__("a0") = exit_code;
  register ulong a1 __asm__("a1") = revert;
  register ulong a7 __asm__("a7") = TN_SYSCALL_CODE_EXIT;
  __asm__ __volatile__("ecall"
                       : "+r"(a0)
                       : "r"(a1), "r"(a7)
                       : "memory");
  __builtin_unreachable();
}

ulong tsys_log(void const* data, ulong data_sz) {
  register ulong a0 __asm__("a0") = (ulong)data;
  register ulong a1 __asm__("a1") = data_sz;
  register ulong a7 __asm__("a7") = TN_SYSCALL_CODE_LOG;
  __asm__("ecall" : "+r"(a0) : "r"(a1), "r"(a7) : "memory");
  return a0;
}

ulong tsys_emit_event(void const* data, ulong data_sz) {
  register ulong a0 __asm__("a0") = (ulong)data;
  register ulong a1 __asm__("a1") = data_sz;
  register ulong a7 __asm__("a7") = TN_SYSCALL_CODE_EMIT_EVENT;
  __asm__("ecall" : "+r"(a0) : "r"(a1), "r"(a7) : "memory");
  return a0;
}

ulong tsys_account_set_flags(ushort account_idx, uchar flags) {
  register ulong a0 __asm__("a0") = (ulong)account_idx;
  register ulong a1 __asm__("a1") = (ulong)flags;
  register ulong a7 __asm__("a7") = TN_SYSCALL_CODE_ACCOUNT_SET_FLAGS;
  __asm__("ecall" : "+r"(a0) : "r"(a1), "r"(a7) : "memory");
  return a0;
}

ulong tsys_account_create_eoa(ulong account_idx, tn_signature_t const * signature,
                              void const* proof, ulong proof_sz) {
  register ulong a0 __asm__("a0") = account_idx;
  register ulong a1 __asm__("a1") = (ulong)signature;
  register ulong a2 __asm__("a2") = (ulong)proof;
  register ulong a3 __asm__("a3") = proof_sz;
  register ulong a7 __asm__("a7") = TN_SYSCALL_CODE_ACCOUNT_CREATE_EOA;
  __asm__("ecall" : "+r"(a0) : "r"(a1), "r"(a2), "r"(a3), "r"(a7) : "memory");
  return a0;
}
