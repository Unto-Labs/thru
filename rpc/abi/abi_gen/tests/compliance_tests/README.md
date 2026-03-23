# ABI Compliance Test Suite

## Overview

This directory contains the canonical binary compliance test suite for the ABI code generator. Instead of cross-language comparison tests, this approach uses:

1. **Canonical Binary Test Data** - Known-good `.bin` files representing correctly encoded ABI types
2. **Test Case Manifests** - YAML files describing what's in each binary and expected values
3. **Language-Specific Test Harnesses** - Decode → Validate → Re-encode → Compare

## Structure

```
tests/compliance_tests/
├── README.md                    # This file
├── TEST_CASE_FORMAT.md          # Test case YAML format specification
├── test_cases/                  # Test case YAML files
│   ├── primitives/              # Primitive type tests
│   │   ├── all_zeros.yaml
│   │   ├── common_values.yaml
│   │   ├── u32_0x12345678.yaml
│   │   └── u64_bigint.yaml
│   ├── structs/                 # Struct type tests
│   ├── arrays/                  # Array type tests
│   └── fams/                    # FAM tests
├── binary_data/                 # Canonical binary test files
│   ├── primitives/
│   │   ├── all_zeros.bin (42 bytes)
│   │   ├── all_max.bin
│   │   ├── common_values.bin
│   │   ├── u32_0x12345678.bin
│   │   ├── u64_bigint.bin
│   │   └── float_values.bin
│   ├── structs/
│   ├── arrays/
│   └── fams/
├── abi_definitions/             # ABI type definitions
│   ├── primitives.abi.yaml     # All 10 primitive types
│   ├── structs.abi.yaml
│   ├── arrays.abi.yaml
│   └── fams.abi.yaml
└── results/                     # Test results (JSON output)
    ├── rust_results.json
    ├── typescript_results.json
    └── c_results.json
```

## Current Status

### ✅ Completed

1. **Directory Structure** - Full test suite directory hierarchy created
2. **Test Case Format** - Documented in `TEST_CASE_FORMAT.md`
3. **Binary Generator Tool** - `tools/generate_primitive_test_binaries.py`
4. **ABI Definitions** - `abi_definitions/primitives.abi.yaml`
5. **Initial Test Cases** - 4 primitive test cases created:
   - `all_zeros.yaml` - All fields set to zero
   - `common_values.yaml` - Typical values including negatives and floats
   - `u32_0x12345678.yaml` - Tests little-endian encoding
   - `u64_bigint.yaml` - Tests BigInt handling in TypeScript
6. **Binary Test Files** - 7 binary files generated (42 bytes each)

### ⏳ Next Steps

1. **Rust Test Harness** - Implement decode-reencode test runner
2. **TypeScript Test Harness** - Same for TypeScript
3. **C Test Harness** - Same for C
4. **More Test Cases** - Struct, array, FAM tests
5. **Master Test Runner** - Script to run all harnesses and aggregate results
6. **CI Integration** - GitHub Actions workflow

## How It Works

### Test Execution Flow

For each test case:

1. **Load Test Case** - Parse `test-case.yaml`
2. **Generate Code** - Run code generator for specified ABI type
3. **Compile Code** - Compile generated code with native toolchain
4. **Decode Binary** - Call `from_array()` with binary data
5. **Validate Values** - Compare decoded fields with `expected` values
6. **Re-encode** - Create new instance and encode to binary
7. **Compare** - Byte-for-byte comparison with original
8. **Report** - Output results to JSON

### Binary File Format

All binary files use little-endian byte order for multi-byte values.

**AllPrimitives struct** (42 bytes total):
```
Offset | Type   | Size | Field
-------|--------|------|-------
0      | u8     | 1    | u8_val
1      | u16    | 2    | u16_val
3      | u32    | 4    | u32_val
7      | u64    | 8    | u64_val
15     | i8     | 1    | i8_val
16     | i16    | 2    | i16_val
18     | i32    | 4    | i32_val
22     | i64    | 8    | i64_val
30     | f32    | 4    | f32_val
34     | f64    | 8    | f64_val
```

Example: `u32_0x12345678.bin` at offset 3-6:
```
Hex: 78 56 34 12
     ^  ^  ^  ^
     |  |  |  +-- MSB (0x12)
     |  |  +----- (0x34)
     |  +-------- (0x56)
     +----------- LSB (0x78)
```

## Adding New Test Cases

### Step 1: Update Binary Generator (if needed)

Edit `tools/generate_primitive_test_binaries.py` to add new binary files.

### Step 2: Generate Binary

```bash
python3 tools/generate_primitive_test_binaries.py
```

### Step 3: Create Test Case YAML

Create `test_cases/{category}/{name}.yaml`:

```yaml
test-case:
  name: "test_name"
  abi-file: "../../abi_definitions/type.abi.yaml"
  type: "TypeName"
  binary-file: "../../binary_data/{category}/file.bin"
  description: "What this tests"
  tags: ["category", "tag"]

  expected:
    field1: value1
    field2: value2
```

### Step 4: Run Test Harness

```bash
# Once implemented:
cargo run --bin compliance_harness_rust -- test_cases/primitives/test_name.yaml
```

## Test Case Examples

### All Zeros

```yaml
test-case:
  name: "all_zeros"
  abi-file: "../../abi_definitions/primitives.abi.yaml"
  type: "AllPrimitives"
  binary-file: "../../binary_data/primitives/all_zeros.bin"
  description: "Test all primitive types with zero values"
  tags: ["primitives", "zero", "baseline"]

  expected:
    u8_val: 0
    u16_val: 0
    u32_val: 0
    u64_val: "0"
    # ... all other fields: 0
```

Binary: `00 00 00 00 00 00 00 00 ...` (42 bytes of zeros)

### Common Values

```yaml
test-case:
  name: "common_values"
  # ...
  expected:
    u8_val: 42
    u16_val: 1000
    u32_val: 0x12345678
    u64_val: "0x123456789ABCDEF0"
    i8_val: -42
    i16_val: -1234
    i32_val: -123456
    i64_val: "-123456789"
    f32_val: 3.14159
    f64_val: 2.718281828459045
```

Binary: `2a 00 e8 03 78 56 34 12 ...` (mixed values, 42 bytes)

## Benefits of This Approach

1. **Language Agnostic** - Binary test data works for all languages
2. **Easy to Add Tests** - Just add YAML + binary file
3. **Specification Compliance** - Tests adherence to ABI spec
4. **Regression Prevention** - Binary files are canonical reference
5. **Granular Testing** - Each test case is isolated
6. **Automated** - Can run entire suite with one command
7. **CI/CD Ready** - JSON output for automated testing
8. **Maintainable** - No custom test code for each type

## Next: Implementing Test Harnesses

The test harnesses will be command-line tools that:

1. Accept test case YAML path as argument
2. Load and parse test case
3. Generate code for specified type
4. Run decode-reencode-compare cycle
5. Output results to JSON

See `TEST_CASE_FORMAT.md` for detailed specification.
