#ifndef HEADER_sdks_cpp_tn_sdk_base_hpp
#define HEADER_sdks_cpp_tn_sdk_base_hpp

#include "types/tn_types.hpp"
#include <concepts>
#include <span>
#include <type_traits>

template <typename T>
concept Trivial = std::is_trivially_copyable_v<T>;

template <typename T>
concept IntegralType = std::is_integral_v<T>;

template <typename T>
concept PointerType = std::is_pointer_v<T>;

// Basic type definitions for compatibility with C SDK
using uchar = unsigned char;
using ushort = unsigned short;
using uint = unsigned int;
using ulong = unsigned long;

// Attribute macros
#define TSDK_PARAM_UNUSED __attribute__((unused))
#define TSDK_LIKELY(c) __builtin_expect(!!(c), 1L)
#define TSDK_UNLIKELY(c) __builtin_expect(!!(c), 0L)

// Entry point function attribute
#define TSDK_ENTRYPOINT_FN                                                     \
  extern "C" __attribute__((section(".text.start"), noreturn))

// Success code
constexpr ulong TSDK_SUCCESS = 0UL;

extern "C" {
const tn_txn* tsdk_get_txn(void);
ushort tsdk_get_current_program_acc_idx(void);
[[noreturn]] void tsdk_revert(ulong error_code);
[[noreturn]] void tsdk_return(ulong return_code);
void tsdk_printf(const char* fmt, ...) __attribute__((format(printf, 1, 2)));
}


#endif /* HEADER_sdks_cpp_tn_sdk_base_hpp */
