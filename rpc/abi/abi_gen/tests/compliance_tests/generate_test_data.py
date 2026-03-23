#!/usr/bin/env python3
"""Generate binary test data for compliance tests."""

import struct
import os
from pathlib import Path

# Get the directory where this script is located
SCRIPT_DIR = Path(__file__).parent
BINARY_DIR = SCRIPT_DIR / "binary_data"

def ensure_dir(path):
    """Ensure directory exists."""
    path.mkdir(parents=True, exist_ok=True)

def write_binary(filename, data):
    """Write binary data to file."""
    filepath = BINARY_DIR / filename
    ensure_dir(filepath.parent)
    with open(filepath, 'wb') as f:
        f.write(data)
    print(f"Generated: {filepath}")

# === ARRAYS ===

def generate_arrays_simple():
    """Generate FixedArrays test data with simple values."""
    data = bytearray()

    # u8_array[4]: [1, 2, 3, 4]
    data.extend([1, 2, 3, 4])

    # u16_array[3]: [10, 20, 30] (little-endian)
    data.extend(struct.pack('<HHH', 10, 20, 30))

    # u32_array[2]: [100, 200] (little-endian)
    data.extend(struct.pack('<II', 100, 200))

    # i32_array[5]: [-1, 0, 1, -100, 100] (little-endian)
    data.extend(struct.pack('<iiiii', -1, 0, 1, -100, 100))

    write_binary('arrays/simple.bin', bytes(data))

def generate_arrays_zeros():
    """Generate FixedArrays test data with all zeros."""
    data = bytearray()

    # u8_array[4]: all zeros
    data.extend([0, 0, 0, 0])

    # u16_array[3]: all zeros
    data.extend(struct.pack('<HHH', 0, 0, 0))

    # u32_array[2]: all zeros
    data.extend(struct.pack('<II', 0, 0))

    # i32_array[5]: all zeros
    data.extend(struct.pack('<iiiii', 0, 0, 0, 0, 0))

    write_binary('arrays/all_zeros.bin', bytes(data))

# === STRUCTS ===

def generate_structs_simple():
    """Generate SimpleStruct test data."""
    data = bytearray()

    # id: u64 = 12345
    data.extend(struct.pack('<Q', 12345))

    # flags: u8 = 0x42
    data.extend(struct.pack('B', 0x42))

    # value: u16 = 9999
    data.extend(struct.pack('<H', 9999))

    write_binary('structs/simple.bin', bytes(data))

def generate_structs_rectangle():
    """Generate Rectangle test data with nested Point2D structs."""
    data = bytearray()

    # top_left: Point2D { x: 10, y: 20 }
    data.extend(struct.pack('<ii', 10, 20))

    # bottom_right: Point2D { x: 100, y: 80 }
    data.extend(struct.pack('<ii', 100, 80))

    # color: u32 = 0xFF0000 (red)
    data.extend(struct.pack('<I', 0xFF0000))

    write_binary('structs/rectangle.bin', bytes(data))

# === ENUMS ===

def generate_enums_none():
    """Generate SimpleEnum::None variant."""
    data = bytearray()

    # tag: u8 = 0
    data.extend(struct.pack('B', 0))

    write_binary('enums/none.bin', bytes(data))

def generate_enums_value():
    """Generate SimpleEnum::Value variant."""
    data = bytearray()

    # tag: u8 = 1
    data.extend(struct.pack('B', 1))

    # data: u32 = 42
    data.extend(struct.pack('<I', 42))

    write_binary('enums/value.bin', bytes(data))

def generate_enums_pair():
    """Generate SimpleEnum::Pair variant."""
    data = bytearray()

    # tag: u8 = 2
    data.extend(struct.pack('B', 2))

    # first: u16 = 100
    data.extend(struct.pack('<H', 100))

    # second: u16 = 200
    data.extend(struct.pack('<H', 200))

    write_binary('enums/pair.bin', bytes(data))

# === UNIONS ===

def generate_unions_int():
    """Generate SimpleUnion with int_value."""
    data = bytearray()

    # int_value: i32 = -42 (little-endian)
    data.extend(struct.pack('<i', -42))

    write_binary('unions/int_value.bin', bytes(data))

def generate_unions_float():
    """Generate SimpleUnion with float_value."""
    data = bytearray()

    # float_value: f32 = 3.14159
    data.extend(struct.pack('<f', 3.14159))

    write_binary('unions/float_value.bin', bytes(data))

def generate_unions_bytes():
    """Generate SimpleUnion with bytes array."""
    data = bytearray()

    # bytes: [0xDE, 0xAD, 0xBE, 0xEF]
    data.extend([0xDE, 0xAD, 0xBE, 0xEF])

    write_binary('unions/bytes.bin', bytes(data))

# === MAIN ===

def main():
    """Generate all test data."""
    print("Generating binary test data...")
    print()

    # Arrays
    print("Arrays:")
    generate_arrays_simple()
    generate_arrays_zeros()
    print()

    # Structs
    print("Structs:")
    generate_structs_simple()
    generate_structs_rectangle()
    print()

    # Enums
    print("Enums:")
    generate_enums_none()
    generate_enums_value()
    generate_enums_pair()
    print()

    # Unions
    print("Unions:")
    generate_unions_int()
    generate_unions_float()
    generate_unions_bytes()
    print()

    print("All binary test data generated successfully!")

if __name__ == '__main__':
    main()
