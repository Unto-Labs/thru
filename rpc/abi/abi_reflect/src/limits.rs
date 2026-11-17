/* Bounds on decoding, so a hostile ABI or buffer cannot exhaust CPU, memory
 * or the stack. A type graph of zero-byte values (`T0` empty, each `Tn` two
 * references to `T(n-1)`) has a zero-byte footprint yet expands to 2^n
 * values, so the number of decoded values is budgeted per decode, not only
 * the bytes. The Go port (`sdks/go/abi/reflect/limits.go`) uses the same
 * values. */

/// Deepest nesting of decoded values (each struct, field, type reference,
/// variant and element is one level).
pub const MAX_DECODE_DEPTH: usize = 256;

/// Values one decode may produce regardless of the buffer size.
pub const DECODE_VALUE_BASE: usize = 1 << 16;

/// Extra values allowed per byte of the buffer.
pub const DECODE_VALUES_PER_BYTE: usize = 8;

/// Most IR nodes one validation may evaluate.
pub const MAX_IR_EVAL_STEPS: usize = 1 << 20;

/// Values a decode of `len` bytes may produce.
pub fn decode_value_budget(len: usize) -> usize {
    DECODE_VALUE_BASE.saturating_add(DECODE_VALUES_PER_BYTE.saturating_mul(len))
}
