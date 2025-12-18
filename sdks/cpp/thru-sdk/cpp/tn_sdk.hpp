#ifndef HEADER_sdks_cpp_tn_sdk_hpp
#define HEADER_sdks_cpp_tn_sdk_hpp

#include "tn_sdk_base.hpp"
#include "tn_sdk_syscall.hpp"
#include "types/tn_types.hpp"

#include <cstdarg>
#include <cstdio>
#include <cstring>

/* TSDK_LOAD( T, src ) safely loads a value of type T from potentially
   unaligned memory location src. This macro provides safe access to
   unaligned memory without causing undefined behavior.

   Equivalent to: return (*(T const *)(src))
   but src can have arbitrary alignment.

   Uses memcpy internally which the compiler will typically optimize
   to direct memory access on platforms supporting unaligned access.

   Example: uint value = TSDK_LOAD( uint, unaligned_ptr ); */

#define TSDK_LOAD( T, src ) \
  (__extension__({ T _tsdk_load_tmp; std::memcpy( &_tsdk_load_tmp, (T const *)(src), sizeof(T) ); _tsdk_load_tmp; }))

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

#define TSDK_STORE( T, dst, val ) \
  (__extension__({ T _tsdk_store_tmp = (val); (T *)std::memcpy( (T *)(dst), &_tsdk_store_tmp, sizeof(T) ); }))

// Address calculation constants
constexpr ulong TSDK_SEG_TYPE_READONLY_DATA = 0x00UL;
constexpr ulong TSDK_SEG_TYPE_ACCOUNT_METADATA = 0x02UL;
constexpr ulong TSDK_SEG_TYPE_ACCOUNT_DATA = 0x03UL;
constexpr ulong TSDK_SEG_TYPE_STACK = 0x05UL;
constexpr ulong TSDK_SEG_TYPE_HEAP = 0x07UL;

constexpr ulong TSDK_SEG_IDX_NULL = 0x0000UL;
constexpr ulong TSDK_SEG_IDX_TXN_DATA = 0x0001UL;
constexpr ulong TSDK_SEG_IDX_SHADOW_STACK = 0x0002UL;
constexpr ulong TSDK_SEG_IDX_PROGRAM = 0x0003UL;
constexpr ulong TSDK_SEG_IDX_BLOCK_CTX = 0x0004UL;
constexpr ulong TSDK_BLOCK_CTX_VM_SPACING = 0x1000UL;

constexpr ulong TN_ACCOUNT_DATA_SZ_MAX = 16UL*1024UL*1024UL; /* Max account data size (excluding metadata) */
constexpr uchar TN_ACCOUNT_V1          = 0x01U;


constexpr uchar TSDK_ACCOUNT_FLAG_PROGRAM        = 0x01U;
constexpr uchar TSDK_ACCOUNT_FLAG_PRIVILEGED     = 0x02U;
constexpr uchar TSDK_ACCOUNT_FLAG_UNCOMPRESSABLE = 0x04U;
constexpr uchar TSDK_ACCOUNT_FLAG_EPHEMERAL      = 0x08U;
constexpr uchar TSDK_ACCOUNT_FLAG_DELETED        = 0x10U;
constexpr uchar TSDK_ACCOUNT_FLAG_NEW            = 0x20U;
constexpr uchar TSDK_ACCOUNT_FLAG_COMPRESSED     = 0x40U;

// C-compatible function declarations
extern "C" {

const tn_account_meta* tsdk_get_account_meta(ushort account_idx);
void* tsdk_get_account_data_ptr(ushort account_idx);
int tsdk_account_exists(ushort account_idx);
const tn_txn* tsdk_get_txn(void);
const tn_block_ctx* tsdk_get_current_block_ctx(void);
const tn_block_ctx* tsdk_get_past_block_ctx(ulong blocks_in_past);
const tsdk_shadow_stack* tsdk_get_shadow_stack(void);

[[noreturn]] void tsdk_revert(ulong error_code);
[[noreturn]] void tsdk_return(ulong return_code);
void tsdk_printf(const char* fmt, ...) __attribute__((format(printf, 1, 2)));

int tsdk_is_account_authorized_by_idx(ushort account_idx);
int tsdk_is_account_authorized_by_pubkey(const pubkey_t* pubkey);
ushort tsdk_get_current_program_acc_idx(void);
const pubkey_t* tsdk_get_current_program_acc_addr(void);
int tsdk_is_account_idx_valid(ushort account_idx);

/* Checks if the account at the given index is owned by the currently
   executing program. Requires that `account_idx` is valid. */
int tsdk_is_account_owned_by_current_program(ushort account_idx);

/* Checks if the current program is already in the shadow stack (i.e.,
   has been invoked recursively). Returns 1 if the program is reentrant,
   0 otherwise. */
int tsdk_is_program_reentrant(void);
}

namespace thru {

// C++ wrapper classes and functions
class Account {
private:
  ushort idx_;

public:
  explicit Account(ushort idx) : idx_(idx) {}

  ushort index() const { return idx_; }

  bool exists() const { return tsdk_account_exists(idx_) != 0; }

  bool is_valid() const { return tsdk_is_account_idx_valid(idx_) != 0; }

  bool is_authorized() const {
    return tsdk_is_account_authorized_by_idx(idx_) != 0;
  }

  /* Checks if the account is owned by the currently executing program. */
  bool is_owned_by_current_program() const {
    return tsdk_is_account_owned_by_current_program(idx_) != 0;
  }

  const tn_account_meta* get_meta() const {
    return tsdk_get_account_meta(idx_);
  }

  void* get_data_ptr() const { return tsdk_get_account_data_ptr(idx_); }

  template <typename T> T* get_data_as() const {
    return static_cast<T*>(get_data_ptr());
  }
};

namespace transaction {
inline const tn_txn* get() { return tsdk_get_txn(); }

inline ushort get_account_count() { return tn_txn_account_cnt(get()); }

inline Account get_account(ushort idx) { return Account(idx); }

inline ushort get_current_program_account_idx() {
  return tsdk_get_current_program_acc_idx();
}
} // namespace transaction

namespace block {
inline const tn_block_ctx* get_context() { return tsdk_get_current_block_ctx(); }

inline const tn_block_ctx* get_context_blocks_ago(ulong blocks_in_past) {
  return tsdk_get_past_block_ctx(blocks_in_past);
}

inline ulong get_time() { return get_context()->block_time; }

inline ulong get_slot() { return get_context()->slot; }

inline ulong get_block_price() { return get_context()->block_price; }

inline const pubkey_t& get_block_producer() {
  return get_context()->block_producer;
}

inline const pubkey_t& get_state_root() { return get_context()->state_root; }
} // namespace block

namespace runtime {
[[noreturn]] inline void revert(ulong error_code) { tsdk_revert(error_code); }

[[noreturn]] inline void return_success(ulong return_code = 0) {
  tsdk_return(return_code);
}

template <typename... Args> void printf(const char* fmt, Args&&... args) {
  tsdk_printf(fmt, args...);
}
} // namespace runtime

template <Trivial T> void zero_memory(T& obj) {
  std::memset(&obj, 0, sizeof(T));
}

template <Trivial T> void copy_memory(T& dest, const T& src) {
  std::memcpy(&dest, &src, sizeof(T));
}

template <Trivial T> bool compare_memory(const T& a, const T& b) {
  return std::memcmp(&a, &b, sizeof(T)) == 0;
}

namespace mem {
constexpr ulong segment_address(ulong seg_type, ulong seg_idx, ulong offset) {
  return seg_type << 40UL | seg_idx << 24UL | offset;
}
} // namespace mem

} // namespace thru

#endif /* HEADER_sdks_cpp_tn_sdk_hpp */
