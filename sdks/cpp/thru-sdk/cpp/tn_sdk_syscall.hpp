#ifndef HEADER_sdks_cpp_tn_sdk_syscall_hpp
#define HEADER_sdks_cpp_tn_sdk_syscall_hpp

#include "tn_sdk_base.hpp"

/* Syscall codes - same as C version */
constexpr ulong TN_SEED_SIZE = 32UL;
constexpr ulong TN_SYSCALL_CODE_SET_ANONYMOUS_SEGMENT_SZ = 0x00UL;
constexpr ulong TN_SYSCALL_CODE_INCREMENT_ANONYMOUS_SEGMENT_SZ = 0x01UL;
constexpr ulong TN_SYSCALL_CODE_SET_ACCOUNT_DATA_WRITABLE = 0x02UL;
constexpr ulong TN_SYSCALL_CODE_ACCOUNT_TRANSFER = 0x03UL;
constexpr ulong TN_SYSCALL_CODE_ACCOUNT_CREATE = 0x04UL;
constexpr ulong TN_SYSCALL_CODE_ACCOUNT_CREATE_EPHEMERAL = 0x05UL;
constexpr ulong TN_SYSCALL_CODE_ACCOUNT_DELETE = 0x06UL;
constexpr ulong TN_SYSCALL_CODE_ACCOUNT_RESIZE = 0x07UL;
constexpr ulong TN_SYSCALL_CODE_ACCOUNT_COMPRESS = 0x08UL;
constexpr ulong TN_SYSCALL_CODE_ACCOUNT_DECOMPRESS = 0x09UL;
constexpr ulong TN_SYSCALL_CODE_INVOKE = 0x0AUL;
constexpr ulong TN_SYSCALL_CODE_EXIT = 0x0BUL;
constexpr ulong TN_SYSCALL_CODE_LOG = 0x0CUL;
constexpr ulong TN_SYSCALL_CODE_EMIT_EVENT = 0x0DUL;
constexpr ulong TN_SYSCALL_CODE_ACCOUNT_SET_FLAGS = 0x0EUL;
constexpr ulong TN_SYSCALL_CODE_ACCOUNT_CREATE_EOA = 0x0FUL;

extern "C" {
// C-compatible syscall functions

ulong tsys_set_account_data_writable(ulong account_idx);

ulong tsys_account_transfer(ulong from_account_idx, ulong to_account_idx,
                            ulong amount);

ulong tsys_set_anonymous_segment_sz(void* addr);

ulong tsys_increment_anonymous_segment_sz(void* segment_addr, ulong delta,
                                          void** addr);

ulong tsys_account_create(ulong account_idx, const unsigned char seed[TN_SEED_SIZE],
                          const void* proof, ulong proof_sz);

ulong tsys_account_create_ephemeral(ulong account_idx, const unsigned char seed[TN_SEED_SIZE]);

ulong tsys_account_delete(ulong account_idx);

ulong tsys_account_resize(ulong account_idx, ulong new_size);

ulong tsys_account_compress(ulong account_idx, const void* proof, ulong proof_sz);

ulong tsys_account_decompress(ulong account_idx, const void* meta, const void* data,
                              const void* proof, ulong proof_sz);

ulong tsys_invoke(const void* instr_data, ulong instr_data_sz,
                  ushort program_account_idx, ulong* invoke_err_code);

[[noreturn]] ulong tsys_exit(ulong exit_code, ulong revert);

ulong tsys_log(const void* data, ulong data_len);

ulong tsys_emit_event(const void* data, ulong data_sz);

ulong tsys_account_set_flags(ushort account_idx, uchar flags);

ulong tsys_account_create_eoa(ulong account_idx,
                              const signature_t* signature,
                              const void* proof,
                              ulong proof_sz);
}

namespace thru {
namespace syscall {

inline ulong account_create(ulong account_idx, std::span<const std::byte, TN_SEED_SIZE> seed,
                            std::span<const std::byte> proof) {
  return tsys_account_create(account_idx, reinterpret_cast<const unsigned char*>(seed.data()),
                             proof.data(), proof.size());
}

inline ulong account_create_ephemeral(ulong account_idx,
                                      std::span<const std::byte, TN_SEED_SIZE> seed) {
  return tsys_account_create_ephemeral(account_idx, reinterpret_cast<const unsigned char*>(seed.data()));
}

inline ulong account_compress(ulong account_idx,
                              std::span<const std::byte> proof) {
  return tsys_account_compress(account_idx, proof.data(), proof.size());
}

inline ulong account_decompress(ulong account_idx,
                                std::span<const std::byte> meta,
                                std::span<const std::byte> data,
                                std::span<const std::byte> proof) {
  return tsys_account_decompress(account_idx, meta.data(), data.data(),
                                 proof.data(), proof.size());
}

inline ulong invoke(std::span<const std::byte> instr_data,
                    ushort program_account_idx, ulong& invoke_error) {
  return tsys_invoke(instr_data.data(), instr_data.size(), program_account_idx, &invoke_error);
}

inline ulong log(std::span<const std::byte> data) {
  return tsys_log(data.data(), data.size());
}

inline ulong emit_event(std::span<const std::byte> data) {
  return tsys_emit_event(data.data(), data.size());
}

inline ulong set_account_data_writable(ulong account_idx) {
  return tsys_set_account_data_writable(account_idx);
}

inline ulong account_transfer(ulong from_account_idx, ulong to_account_idx,
                              ulong amount) {
  return tsys_account_transfer(from_account_idx, to_account_idx, amount);
}

[[noreturn]] inline void exit(ulong exit_code, bool revert = false) {
  tsys_exit(exit_code, revert ? 1UL : 0UL);
}

inline ulong account_set_flags(ushort account_idx, uchar flags) {
  return tsys_account_set_flags(account_idx, flags);
}

inline ulong account_create_eoa(ulong account_idx,
                                const signature_t* signature,
                                std::span<const std::byte> proof) {
  return tsys_account_create_eoa(account_idx, signature,
                                 proof.data(), proof.size());
}

} // namespace syscall
} // namespace thru

#endif /* HEADER_sdks_cpp_tn_sdk_syscall_hpp */
