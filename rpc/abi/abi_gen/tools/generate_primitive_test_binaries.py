#!/usr/bin/env python3
"""
Generate binary test files for primitive type compliance tests.

AllPrimitives struct layout (little-endian, packed):
- u8_val:  1 byte  @ offset 0
- u16_val: 2 bytes @ offset 1
- u32_val: 4 bytes @ offset 3
- u64_val: 8 bytes @ offset 7
- i8_val:  1 byte  @ offset 15
- i16_val: 2 bytes @ offset 16
- i32_val: 4 bytes @ offset 18
- i64_val: 8 bytes @ offset 22
- f32_val: 4 bytes @ offset 30
- f64_val: 8 bytes @ offset 34
Total: 42 bytes
"""

import struct
import os
import sys

def write_binary(filename, u8, u16, u32, u64, i8, i16, i32, i64, f32, f64):
    """Write AllPrimitives binary file with given values."""
    data = struct.pack('<BHIQbhiqfd',
        u8, u16, u32, u64,
        i8, i16, i32, i64,
        f32, f64
    )

    output_dir = 'tests/compliance_tests/binary_data/primitives'
    os.makedirs(output_dir, exist_ok=True)

    filepath = os.path.join(output_dir, filename)
    with open(filepath, 'wb') as f:
        f.write(data)

    print(f"Created {filepath} ({len(data)} bytes)")
    return filepath

def main():
    # All zeros
    write_binary('all_zeros.bin',
        0, 0, 0, 0,
        0, 0, 0, 0,
        0.0, 0.0
    )

    # All max values (for unsigned/positive)
    write_binary('all_max.bin',
        255,             # u8::MAX
        65535,           # u16::MAX
        4294967295,      # u32::MAX
        18446744073709551615,  # u64::MAX
        127,             # i8::MAX
        32767,           # i16::MAX
        2147483647,      # i32::MAX
        9223372036854775807,   # i64::MAX
        3.4028235e38,    # f32::MAX (approx)
        1.7976931348623157e308  # f64::MAX (approx)
    )

    # All min values (for signed)
    write_binary('all_min_signed.bin',
        0,               # u8 min
        0,               # u16 min
        0,               # u32 min
        0,               # u64 min
        -128,            # i8::MIN
        -32768,          # i16::MIN
        -2147483648,     # i32::MIN
        -9223372036854775808,  # i64::MIN
        -3.4028235e38,   # f32::MIN (approx)
        -1.7976931348623157e308  # f64::MIN (approx)
    )

    # Common values
    write_binary('common_values.bin',
        42,              # u8
        1000,            # u16
        0x12345678,      # u32
        0x123456789ABCDEF0,  # u64
        -42,             # i8
        -1234,           # i16
        -123456,         # i32
        -123456789,      # i64
        3.14159,         # f32 (pi)
        2.718281828459045  # f64 (e)
    )

    # Test little-endian explicitly
    write_binary('u32_0x12345678.bin',
        0,               # u8
        0,               # u16
        0x12345678,      # u32 - should be [78 56 34 12]
        0,               # u64
        0, 0, 0, 0,      # signed ints
        0.0, 0.0         # floats
    )

    # Test u64 BigInt
    write_binary('u64_bigint.bin',
        0, 0, 0,
        0x123456789ABCDEF0,  # u64 - needs BigInt in TypeScript
        0, 0, 0, 0,
        0.0, 0.0
    )

    # Test floats
    write_binary('float_values.bin',
        0, 0, 0, 0,
        0, 0, 0, 0,
        3.14159265,      # f32
        2.718281828459045  # f64
    )

    print(f"\n✓ Generated 7 primitive test binary files")

if __name__ == '__main__':
    main()
