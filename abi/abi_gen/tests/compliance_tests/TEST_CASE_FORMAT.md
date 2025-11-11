# Compliance Test Case Format

## Overview

Each compliance test case consists of:
1. **Test Case YAML** - Defines what to test with embedded binary data
2. **ABI Definition** - The type definition being tested

## Test Case YAML Format

### Basic Structure

```yaml
test-case:
  name: "descriptive_test_name"
  abi-file: "relative/path/to/definition.abi.yaml"
  type: "TypeName"
  binary-hex: "0102030405060708"  # Hex-encoded binary data
  description: "What this test verifies"
  tags: ["category", "subcategory"]
```

### Primitive Type Test Case

```yaml
test-case:
  name: "u32_max"
  abi-file: "../abi_definitions/primitives.abi.yaml"
  type: "AllPrimitives"
  binary-hex: "00000000ffffffff000000000000000000000000000000000000000000000000000000000000000000000000"
  description: "Test maximum value for u32 type"
  tags: ["primitives", "u32", "edge-case"]
```

### Struct Type Test Case

```yaml
test-case:
  name: "point2d_positive"
  abi-file: "../abi_definitions/structs.abi.yaml"
  type: "Point2D"
  binary-hex: "6400c800"  # x=100 (0x64), y=200 (0xc8) in little-endian u16
  description: "Test struct with positive coordinate values"
  tags: ["struct", "packed"]
```

### Array Type Test Case

```yaml
test-case:
  name: "fixed_array_sequential"
  abi-file: "../abi_definitions/arrays.abi.yaml"
  type: "FixedArrayU32"
  binary-hex: "00000000010000000200000003000000040000000500000006000000070000000800000009000000"
  description: "Test fixed array with sequential values [0,1,2,3,4,5,6,7,8,9]"
  tags: ["array", "fixed-size"]
```

### Enum Type Test Case

```yaml
test-case:
  name: "enum_value_variant"
  abi-file: "../abi_definitions/enums.abi.yaml"
  type: "SimpleEnum"
  binary-hex: "0164000000"  # tag=1, u32 data=100
  description: "Test enum with Value variant containing u32=100"
  tags: ["enum", "variable-size"]
```

### FAM (Flexible Array Member) Test Case

```yaml
test-case:
  name: "fam_variable_length"
  abi-file: "../abi_definitions/fams.abi.yaml"
  type: "DynamicBuffer"
  binary-hex: "050000000a141e2832"  # length=5, data=[10,20,30,40,50]
  description: "Test FAM with 5 elements"
  tags: ["fam", "variable-size"]
```

## Binary Hex Format

### Encoding Rules

- **Hex string format**: Continuous hex digits (0-9, a-f, A-F)
- **Byte order**: Little-endian for multi-byte values
- **No separators**: No spaces, colons, or 0x prefixes between bytes
- **Case insensitive**: Both uppercase and lowercase hex digits accepted
- **Even length**: Must have even number of hex digits (whole bytes)

### Examples by Type

#### Integers (Little-Endian)

```yaml
# u8: 255
binary-hex: "ff"

# u16: 1000 (0x03e8)
binary-hex: "e803"

# u32: 4294967295 (0xffffffff)
binary-hex: "ffffffff"

# u64: 9223372036854775807 (0x7fffffffffffffff)
binary-hex: "ffffffffffffff7f"

# i8: -1
binary-hex: "ff"

# i16: -1000 (0xfc18)
binary-hex: "18fc"

# i32: -2147483648 (0x80000000)
binary-hex: "00000080"

# i64: -9223372036854775808 (0x8000000000000000)
binary-hex: "0000000000000080"
```

#### Floats (Little-Endian IEEE 754)

```yaml
# f32: 3.14159 (0x40490fd0)
binary-hex: "d00f4940"

# f64: 2.718281828459045 (0x4005bf0a8b145769)
binary-hex: "6957148b0abf0540"

# f32: NaN
binary-hex: "0000c07f"

# f32: Infinity
binary-hex: "0000807f"

# f32: -Infinity
binary-hex: "000080ff"
```

#### Arrays

```yaml
# [u8; 4]: [1, 2, 3, 4]
binary-hex: "01020304"

# [u16; 3]: [100, 200, 300] (little-endian)
binary-hex: "6400c8002c01"

# [u32; 2]: [0x12345678, 0xabcdef01]
binary-hex: "7856341201efcdab"
```

#### Structs (Packed)

```yaml
# struct Point2D { x: u16, y: u16 }
# Point2D { x: 100, y: 200 }
binary-hex: "6400c800"

# struct Color { r: u8, g: u8, b: u8 }
# Color { r: 255, g: 128, b: 64 }
binary-hex: "ff8040"
```

## Test Result Format

Test harnesses output results in JSON format:

```json
{
  "test_run": {
    "timestamp": "2025-11-04T16:00:00Z",
    "language": "rust",
    "harness_version": "2.0.0",
    "total_tests": 50,
    "passed": 48,
    "failed": 2,
    "skipped": 0,
    "duration_ms": 1234
  },
  "results": [
    {
      "test_name": "u32_max",
      "test_file": "primitives/u32_max.yaml",
      "status": "pass",
      "duration_ms": 12,
      "stages": {
        "code_generation": "ok",
        "compilation": "ok",
        "decode": "ok",
        "validation": "ok",
        "reencode": "ok",
        "binary_match": true
      }
    },
    {
      "test_name": "fam_overflow",
      "test_file": "fams/fam_overflow.yaml",
      "status": "fail",
      "duration_ms": 5,
      "stages": {
        "code_generation": "ok",
        "compilation": "ok",
        "decode": "pending",
        "validation": "pending",
        "reencode": "pending",
        "binary_match": false
      },
      "error": {
        "stage": "decode",
        "message": "Buffer overflow in FAM size calculation",
        "details": "Expected size 100, buffer size 50"
      }
    }
  ]
}
```

## Test Harness Behavior

### Test Execution Flow

1. **Load Test Case**
   - Parse test case YAML
   - Validate all required fields present
   - Load referenced ABI definition
   - Decode binary-hex to byte array

2. **Generate Code**
   - Run code generator for specified type
   - Compile generated code
   - Handle compilation errors gracefully

3. **Decode Binary**
   - Convert hex string to byte buffer
   - Call generated `from_array()` or `from_slice()` function
   - Catch any decode errors

4. **Validate Structure**
   - Verify decode succeeded
   - Check that structure size matches binary size
   - Validate any runtime constraints

5. **Re-encode**
   - Create copy instance from decoded data
   - Get raw buffer from copied instance
   - Compare byte-for-byte with original binary

6. **Report Results**
   - Output JSON to stdout or file
   - Include detailed error information for failures
   - Aggregate statistics

### Error Handling

Test harnesses should handle these error conditions:

- **Missing files**: ABI definition, test case YAML
- **Parse errors**: Invalid YAML, invalid ABI definition, invalid hex string
- **Invalid hex**: Odd length, non-hex characters
- **Code generation errors**: Unsupported types, malformed ABI
- **Compilation errors**: Generated code doesn't compile
- **Decode errors**: Invalid binary data, buffer too small
- **Validation errors**: Structure constraints violated
- **Re-encode errors**: Can't reconstruct original binary

Each error should:
- Mark test as "fail" with specific error stage
- Include error message and details
- Continue to next test (don't abort entire run)

## Directory Structure

```
tests/compliance_tests/
├── test_cases/
│   ├── primitives/
│   │   ├── u8_zero.yaml
│   │   ├── u8_max.yaml
│   │   ├── u32_max.yaml
│   │   └── ...
│   ├── structs/
│   │   ├── point2d_zero.yaml
│   │   ├── simple_struct.yaml
│   │   └── ...
│   ├── arrays/
│   │   ├── fixed_array_u32.yaml
│   │   └── ...
│   ├── enums/
│   │   ├── simple_enum_none.yaml
│   │   ├── simple_enum_value.yaml
│   │   └── ...
│   └── fams/
│       ├── fam_simple.yaml
│       └── ...
├── abi_definitions/
│   ├── primitives.abi.yaml
│   ├── structs.abi.yaml
│   ├── arrays.abi.yaml
│   ├── enums.abi.yaml
│   └── fams.abi.yaml
└── results/
    ├── rust_results.json
    ├── typescript_results.json
    └── c_results.json
```

## Best Practices

### Naming Conventions

- **Test case names**: `{type}_{variant}` - e.g., `u32_max`, `struct_zero`
- **File names**: Match test case name - `u32_max.yaml`
- **Descriptive tags**: Use tags to categorize tests for filtering

### Test Coverage

Create test cases for:
- **Zero values**: All zeros
- **Maximum values**: Type max (e.g., u32::MAX)
- **Minimum values**: Type min (e.g., i32::MIN)
- **Common values**: Typical use cases
- **Edge cases**: Boundary conditions, special float values
- **Variable-size types**: Different variants, different sizes
- **Negative tests**: Invalid data (for error path testing)

### Binary Data Guidelines

Binary hex strings should be:
- **Canonical**: Represent the "correct" encoding per ABI spec
- **Little-endian**: All multi-byte values in little-endian order
- **Documented**: Include comment in YAML explaining binary structure
- **Minimal**: Only the data needed for the test (no padding unless testing alignment)
- **Verified**: Double-check hex encoding matches intended values

### Hex String Tips

```yaml
# Good: Compact, documented
binary-hex: "6400c800"  # Point2D { x: 100, y: 200 }

# Good: Multi-line for readability of long hex
binary-hex: >
  00000000010000000200000003000000
  04000000050000000600000007000000
  08000000090000000a0000000b000000
  # 12 u32 values: [0, 1, 2, ..., 11]

# Bad: Spaces or separators (will fail to parse)
binary-hex: "64 00 c8 00"

# Bad: 0x prefixes (will fail to parse)
binary-hex: "0x64 0x00 0xc8 0x00"

# Bad: Odd length (incomplete bytes)
binary-hex: "640"
```

### Maintenance

- **Version control**: All test files in git
- **Documentation**: Each test case should have clear description
- **Regression**: Once a bug is found, add test case to prevent regression
- **Review**: New test cases should be reviewed for correctness
- **Hex verification**: Use hex calculators or scripts to verify binary encoding
