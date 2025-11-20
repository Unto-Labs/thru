# Comprehensive ABI Code Generation Compliance Testing Plan

**Version:** 1.0
**Date:** 2025-11-02
**Status:** Active

## Overview

This document defines a systematic approach to ensure all generated code (C, Rust, TypeScript) fully complies with the ABI specification (see `ABI_SPECIFICATION.md`) across all language targets.

## Testing Strategy

### Phase 1: Specification-Driven Test Matrix

Create a comprehensive test matrix covering every feature in the ABI spec:

#### 1.1 Primitive Types Testing

**Coverage:** U8, U16, U32, U64, I8, I16, I32, I64, F16, F32, F64

Test for each language:
- ✓ Correct size (1, 2, 4, 8 bytes)
- ✓ Little-endian byte order
- ✓ Proper type mapping (TypeScript: bigint for 64-bit integers)
- ✓ Alignment requirements
- ✓ Read/write correctness

**Test Implementation:**
```rust
#[test]
fn test_primitive_u64_size() {
    // Verify U64 is 8 bytes in all languages
    assert_eq!(generated_c_sizeof_u64(), 8);
    assert_eq!(generated_rust_sizeof_u64(), 8);
    assert_eq!(generated_ts_sizeof_u64(), 8);
}

#[test]
fn test_primitive_endianness() {
    // Write 0x0102030405060708 in each language
    // Verify bytes are [08, 07, 06, 05, 04, 03, 02, 01]
}
```

#### 1.2 Fixed-Size Arrays Testing

**Coverage:**
- 1D arrays: `[T; N]` for various N (1, 2, 32, 1024)
- 2D arrays: `[[T; M]; N]` with different dimensions
- 3D+ arrays: Deeply nested arrays

**Verify:**
- Row-major ordering
- Correct total size (N × sizeof(T))
- Boundary access
- Alignment preservation

**Test Cases:**
- `[u8; 1]` - Single element
- `[u32; 32]` - Common array size
- `[[u8; 3]; 2]` - 2D array with row-major order
- `[[[u64; 2]; 3]; 4]` - 3D array

#### 1.3 Flexible Array Members (FAMs)

**Coverage:**
- Single FAM at end of struct
- Multiple FAMs with interleaved constant fields
- Multi-dimensional FAMs with variable dimensions
- Nested FAMs in complex structures

**Verify:**
- Offset calculation correctness
- Runtime size calculation
- `footprint()` parameter handling
- Field access after FAMs

**Example Test Cases:**
```yaml
# Simple FAM
struct SimpleFAM:
  length: u32
  data: [u8; length]

# Multiple interleaved FAMs
struct MultipleFAMs:
  count1: u32
  data1: [u8; count1]
  count2: u16
  data2: [u16; count2]
  constant_after: u8

# Multi-dimensional FAM
struct MatrixFAM:
  rows: u32
  cols: u32
  data: [[f32; cols]; rows]
```

#### 1.4 Struct Testing

**Packed Structs** (`packed: true`):
- No padding between fields
- 1-byte alignment
- Correct size calculation

**Aligned Structs** (default):
- Natural alignment per field
- Padding insertion
- Size rounded to alignment

**Custom Alignment** (`aligned: N`):
- Verify custom alignment applied
- Padding correctness

**Test Implementation:**
```yaml
# Test packed struct
struct PackedTest:
  packed: true
  fields:
    - a: u8   # offset 0
    - b: u32  # offset 1 (no padding)
    - c: u16  # offset 5 (no padding)
# Total size: 7 bytes

# Test aligned struct
struct AlignedTest:
  fields:
    - a: u8   # offset 0
    - b: u32  # offset 4 (3 bytes padding)
    - c: u16  # offset 8
# Total size: 12 bytes (rounded to u32 alignment)
```

#### 1.5 Union Testing

**Verify:**
- Size = max(variant sizes)
- All fields start at offset 0
- No tag field (untagged union)
- Type-specific `new()` methods for each variant
- Memory overlay behavior

**Test Cases:**
```yaml
union ValueUnion:
  variants:
    - small: u8      # 1 byte
    - medium: u32    # 4 bytes
    - large: u64     # 8 bytes
# Size: 8 bytes
# All variants at offset 0
```

#### 1.6 Enum (Tagged Union) Testing

**External Tag Field References:**
- Sibling field: `["tag"]`
- Parent field: `["parent", "tag"]`
- Nested field: `["outer", "inner", "tag"]`

**Tag Validation:**
- Valid tag values accepted
- Invalid tag values rejected
- Gaps in tag values handled correctly

**Variant Properties:**
- Variant size = max(all variants)
- Correct variant access by tag value

**Test Cases:**
```yaml
# Sibling tag reference
struct SimpleEnum:
  tag: u8
  body:
    enum:
      tag-ref: ["tag"]
      variants:
        - Variant1 (tag=0): u32
        - Variant2 (tag=1): u64

# Nested tag reference
struct NestedEnum:
  header:
    struct:
      fields:
        - type_tag: u16
  data:
    enum:
      tag-ref: ["header", "type_tag"]
      variants:
        - TypeA (tag=100): [u8; 4]
        - TypeB (tag=200): [u16; 8]
```

#### 1.7 Size-Discriminated Union Testing

**Verify:**
- Variant selection by byte size
- Expected-size matching
- FAMs within variants
- Validation of size constraints

**Test Cases:**
```yaml
size-discriminated-union ProtocolMessage:
  SmallMsg:
    expected-size: 8
    type:
      struct:
        type: u16
        value: u32
        padding: u16

  LargeMsg:
    expected-size: 16
    type:
      struct:
        type: u16
        value: u64
        extra: u32
        padding: u16
```

#### 1.8 Type References

**Verify:**
- Simple names within same package
- FQDN references across packages
- Import resolution correctness
- Recursive references properly rejected

**Test Cases:**
- Same package: `Hash` → resolves to local type
- FQDN: `thru.common.primitives.Hash` → cross-package reference
- Invalid: Self-referential or circular types → error

---

## Phase 2: Cross-Language Binary Compatibility Suite

### 2.1 Test Matrix Structure

For each ABI feature F, test all language pairs:

```
Language Pairs: {C, Rust, TS}
For each pair (L1, L2):
  Test 1: L1 writes binary → L2 reads → verify correctness
  Test 2: L2 writes binary → L1 reads → verify correctness
  Test 3: Compare L1.size() == L2.size()
  Test 4: Compare L1.footprint() == L2.footprint()
  Test 5: Binary byte-for-byte comparison
```

### 2.2 Feature Coverage

**Binary Compatibility Tests Required For:**
- All 11 primitive types
- All array types (1D, 2D, 3D, fixed, variable)
- All struct types (packed, aligned, custom alignment)
- All union types
- All enum types with various tag patterns
- All size-discriminated unions
- Complex nested combinations

### 2.3 Test Data Generation

**Hand-Crafted Test Cases:**
- Edge values (0, 1, max, min)
- Common patterns (powers of 2, sequential)
- Boundary conditions

**Random Valid Data:**
- Property-based generation
- Constrained randomization
- Seed-based reproducibility

**Invalid Data (Validation Testing):**
- Buffer too small
- Invalid tag values
- Malformed structures
- Overflow conditions

### 2.4 Implementation Example

```rust
#[test]
fn test_cross_lang_simple_fam_c_to_rust() {
    // C writes SimpleFAM to file
    let c_binary = generate_c_simple_fam(&[1, 2, 3, 4, 5]);

    // Rust reads and validates
    let rust_obj = SimpleFAM::from_array(&c_binary).expect("Valid");

    // Verify data matches
    assert_eq!(rust_obj.get_length(), 5);
    assert_eq!(rust_obj.get_data(), &[1, 2, 3, 4, 5]);
}

#[test]
fn test_cross_lang_enum_ts_to_c() {
    // TypeScript creates enum with tag=1
    let ts_binary = ts_create_enum_variant1(0x12345678);

    // C reads and interprets
    let c_tag = c_read_enum_tag(&ts_binary);
    let c_value = c_read_enum_variant1(&ts_binary);

    assert_eq!(c_tag, 1);
    assert_eq!(c_value, 0x12345678);
}
```

---

## Phase 3: Generated Function Compliance Tests

### 3.1 footprint() Function Tests

**Requirements:**
- Constant-size types: Returns `sizeof(T)`
- Variable-size types: Accepts correct parameters
- Parameter validation: Negative sizes rejected
- Overflow protection: Safe arithmetic
- Nested FAMs: Correct recursive calculation
- Enum variants: Tag-dependent size

**Test Matrix:**
```rust
struct FootprintTest {
    type_name: &'static str,
    is_constant: bool,
    expected_size: Option<usize>,
    params: Vec<i64>,
    expected_result: Result<usize, &'static str>,
}

const FOOTPRINT_TESTS: &[FootprintTest] = &[
    // Constant size
    FootprintTest {
        type_name: "u32",
        is_constant: true,
        expected_size: Some(4),
        params: vec![],
        expected_result: Ok(4),
    },

    // Variable size - simple FAM
    FootprintTest {
        type_name: "SimpleFAM",
        is_constant: false,
        expected_size: None,
        params: vec![10], // length=10
        expected_result: Ok(4 + 10), // sizeof(u32) + 10 bytes
    },

    // Variable size - overflow check
    FootprintTest {
        type_name: "SimpleFAM",
        is_constant: false,
        expected_size: None,
        params: vec![i64::MAX],
        expected_result: Err("overflow"),
    },
];
```

### 3.2 new() Function Tests

**Requirements:**
- Buffer allocation: Correct size
- Field initialization: All fields set correctly
- Little-endian writes: Proper byte order
- FAM initialization: Dynamic arrays filled
- Validation called: `new()` validates before return
- Error handling: Returns null/error on failure

**Test Implementation:**
```rust
#[test]
fn test_new_initializes_all_fields() {
    let obj = MyStruct::new(42, 100, &[1, 2, 3]);

    assert_eq!(obj.get_field1(), 42);
    assert_eq!(obj.get_field2(), 100);
    assert_eq!(obj.get_array(), &[1, 2, 3]);
}

#[test]
fn test_new_validates_input() {
    // Attempt to create with invalid tag value
    let result = MyEnum::new(999, data);
    assert!(result.is_none()); // Should reject invalid tag
}

#[test]
fn test_new_endianness() {
    let obj = MyStruct::new(0x01020304);
    let bytes = obj.as_bytes();

    // Verify little-endian: [04, 03, 02, 01]
    assert_eq!(bytes[0], 0x04);
    assert_eq!(bytes[1], 0x03);
    assert_eq!(bytes[2], 0x02);
    assert_eq!(bytes[3], 0x01);
}
```

### 3.3 from_array() Validation Tests

**Buffer Size Validation:**
- Too small → reject (return null)
- Exact size → accept
- Larger than needed → accept

**Tag Validation (Enums):**
- Valid tags → accept
- Invalid tags → reject
- Out of range → reject

**Nested Validation:**
- Recursive structure checks
- FAM bounds checking
- Null return on any failure

**Test Matrix:**
```rust
struct ValidationTest {
    test_name: &'static str,
    buffer: Vec<u8>,
    expected: Result<(), &'static str>,
}

const VALIDATION_TESTS: &[ValidationTest] = &[
    ValidationTest {
        test_name: "buffer_too_small",
        buffer: vec![0; 5],  // Need 8 bytes
        expected: Err("buffer too small"),
    },

    ValidationTest {
        test_name: "invalid_enum_tag",
        buffer: vec![99, 0, 0, 0, 0, 0, 0, 0],  // tag=99 invalid
        expected: Err("invalid tag"),
    },

    ValidationTest {
        test_name: "valid_data",
        buffer: vec![1, 0x78, 0x56, 0x34, 0x12, 0, 0, 0],
        expected: Ok(()),
    },
];
```

### 3.4 Getter/Setter Function Tests

**Verify:**
- Offset correctness: Field at right memory location
- Endianness: Little-endian reads/writes
- Type conversions: Proper casting
- Array access: Bounds checking
- Nested field access: Correct path resolution

**Test Cases:**
```rust
#[test]
fn test_getter_offset_correctness() {
    let buffer = vec![0; 100];
    let obj = MyStruct::from_array(&buffer).unwrap();

    // Verify field2 is at offset 4
    let field2_ptr = (&obj.buffer[4..]).as_ptr();
    let getter_value = obj.get_field2();

    // Both should read from same location
    assert_eq!(getter_value, read_u32_le(&buffer[4..]));
}

#[test]
fn test_nested_field_access() {
    let obj = OuterStruct::new(...);
    let inner_tag = obj.get_inner().get_tag();

    // Should correctly traverse nested path
    assert_eq!(inner_tag, expected_tag);
}
```

### 3.5 size() Function Tests

**Requirements:**
- Constant-size types: Returns `sizeof(T)`
- Variable-size types: Calculates from FAM values
- Runtime calculation: Correct for all FAMs
- Matches written data: `size()` == actual bytes written

**Test Implementation:**
```rust
#[test]
fn test_size_matches_written_data() {
    let obj = SimpleFAM::new(5, &[1, 2, 3, 4, 5]);
    let calculated_size = obj.size();
    let actual_bytes = obj.as_bytes();

    assert_eq!(calculated_size, actual_bytes.len());
    assert_eq!(calculated_size, 4 + 5); // u32 length + 5 bytes
}

#[test]
fn test_size_with_multiple_fams() {
    let obj = MultipleFAMs::new(...);
    let size = obj.size();

    // Verify includes all FAMs and constant fields
    let expected = sizeof_constants + size_fam1 + size_fam2;
    assert_eq!(size, expected);
}
```

### 3.6 validate() Function Tests

**Requirements:**
- Error codes/nulls: Correct return values
- Buffer bounds: Proper checking
- Tag ranges: Enum validation
- Recursive validation: Nested types checked
- Performance: No unnecessary work

**Test Cases:**
```rust
#[test]
fn test_validate_recursive() {
    let buffer = create_nested_structure_buffer();
    let result = OuterStruct::validate(&buffer);

    // Should validate all nested structures
    assert!(result.is_ok());
}

#[test]
fn test_validate_performance() {
    let buffer = create_large_structure();

    let start = Instant::now();
    let _ = LargeStruct::validate(&buffer);
    let duration = start.elapsed();

    // Validation should be fast (< 1ms for typical structures)
    assert!(duration < Duration::from_millis(1));
}
```

---

## Phase 4: Edge Case and Error Path Testing

### 4.1 Boundary Conditions

**Test Cases:**
- Zero-size arrays: `[T; 0]` if specification allows
- Maximum sizes: Large arrays, deep nesting limits
- Minimum values: All zeros, minimum integers
- Maximum values: Max integers, fully populated arrays
- Alignment boundaries: Fields crossing cache lines/pages

**Example:**
```rust
#[test]
fn test_maximum_array_size() {
    // Test with very large array
    let size = 1_000_000;
    let obj = LargeArray::new(size, default_value);

    assert_eq!(obj.footprint(), sizeof_header + size);
}

#[test]
fn test_deep_nesting() {
    // Create deeply nested structure
    let depth = 100;
    let obj = create_nested_struct(depth);

    // Should handle deep nesting without stack overflow
    assert!(obj.validate().is_ok());
}
```

### 4.2 Invalid Input Testing

**Coverage:**
- Too-small buffers
- Corrupted data
- Overflow conditions
- Null/invalid pointers (C only)
- Misaligned access

**Test Matrix:**
```rust
#[test]
fn test_buffer_too_small() {
    let buffer = vec![0; 4]; // Need 8 bytes
    let result = MyStruct::from_array(&buffer);

    assert!(result.is_none());
}

#[test]
fn test_corrupted_tag() {
    let mut buffer = valid_enum_buffer();
    buffer[0] = 255; // Invalid tag value

    let result = MyEnum::from_array(&buffer);
    assert!(result.is_none());
}

#[test]
fn test_overflow_in_size_calculation() {
    let result = MyFAM::new(u64::MAX, data);

    // Should reject overflow
    assert!(result.is_none());
}
```

### 4.3 Malformed ABI Definitions

**Error Detection:**
- Circular dependencies
- Forward references in expressions
- Invalid field references
- Type mismatches

**These should be caught at code generation time, not runtime**

---

## Phase 5: TypeScript-Specific Testing

### 5.1 Compilation Testing

**Requirements:**
- TypeScript compiler (`tsc`) with `--strict` mode
- No compilation warnings
- Proper type checking
- BigInt support for 64-bit integers

**Test Script:**
```bash
#!/bin/bash
# tests/ts_tests/compile_test.sh

set -e

# Generate TypeScript code
cargo run -- codegen --files tests/all_features.abi.yaml \
  --language typescript --output generated-ts

# Compile with strict TypeScript
cd generated-ts
tsc --strict --noEmit --target ES2020 --lib ES2020 **/*.ts

echo "✓ TypeScript compilation successful"
```

### 5.2 Runtime Testing

**Coverage:**
- Node.js execution
- Browser compatibility (if applicable)
- DataView correctness
- Uint8Array operations

**Test Implementation:**
```typescript
// tests/ts_tests/runtime_test.ts
import { MyStruct } from './generated/types';

function test_basic_operations() {
    // Create new instance
    const obj = MyStruct.new(42, 100);

    // Verify fields
    assert(obj.get_field1() === 42);
    assert(obj.get_field2() === 100);

    // Verify footprint
    assert(MyStruct.footprint() === 8);

    console.log("✓ Basic operations test passed");
}

function test_validation() {
    const buffer = new Uint8Array([0, 0, 0, 0]); // Too small
    const obj = MyStruct.from_array(buffer);

    assert(obj === null); // Should reject

    console.log("✓ Validation test passed");
}

test_basic_operations();
test_validation();
```

### 5.3 Cross-Language Integration

**Three-Language Tests:**
```
C → Rust → TypeScript → Verify
Rust → TypeScript → C → Verify
TypeScript → C → Rust → Verify
```

**Test Flow:**
1. Language A writes binary data to file
2. Language B reads, validates, modifies, writes
3. Language C reads and validates final result
4. Compare with expected output

---

## Phase 6: Property-Based Testing

### 6.1 Random ABI Generation

**Strategy:**
- Generate valid random ABI definitions
- All combinations of features
- Various nesting depths
- Different size constraints

**Implementation with `proptest`:**
```rust
use proptest::prelude::*;

proptest! {
    #[test]
    fn test_random_struct_roundtrip(
        field_count in 1..10usize,
        packed in any::<bool>(),
    ) {
        // Generate random struct definition
        let abi = generate_random_struct(field_count, packed);

        // Generate code for all languages
        let (c_code, rust_code, ts_code) = generate_all_code(&abi);

        // Compile all
        compile_c(&c_code)?;
        compile_rust(&rust_code)?;
        compile_ts(&ts_code)?;

        // Test round-trip
        let test_data = generate_random_data(&abi);
        assert!(test_roundtrip(&abi, &test_data));
    }
}
```

### 6.2 Invariant Testing

**Invariants to Verify:**
- **Round-trip**: write → read → equals original
- **Size consistency**: `size()` == actual bytes written
- **Alignment**: All fields properly aligned (non-packed)
- **Endianness**: Little-endian throughout
- **Validation**: `validate()` accepts own `new()` output

**Test Implementation:**
```rust
fn test_invariants<T: AbiType>(obj: &T) {
    // Invariant 1: Round-trip
    let bytes = obj.as_bytes();
    let obj2 = T::from_array(bytes).expect("Round-trip failed");
    assert_eq!(obj, obj2);

    // Invariant 2: Size consistency
    assert_eq!(obj.size(), bytes.len());

    // Invariant 3: Validation accepts new() output
    assert!(T::validate(bytes).is_ok());

    // Invariant 4: Endianness
    verify_little_endian(bytes);
}
```

### 6.3 Differential Testing

**Strategy:**
Compare C vs Rust vs TypeScript for identical operations:

```rust
#[test]
fn test_differential_all_primitives() {
    for primitive_type in ALL_PRIMITIVES {
        let test_value = generate_test_value(primitive_type);

        // Generate and write in all languages
        let c_bytes = c_write(primitive_type, test_value);
        let rust_bytes = rust_write(primitive_type, test_value);
        let ts_bytes = ts_write(primitive_type, test_value);

        // All must produce identical bytes
        assert_eq!(c_bytes, rust_bytes);
        assert_eq!(rust_bytes, ts_bytes);

        // All must read back same value
        assert_eq!(c_read(&c_bytes), test_value);
        assert_eq!(rust_read(&rust_bytes), test_value);
        assert_eq!(ts_read(&ts_bytes), test_value);
    }
}
```

---

## Phase 7: Specification Compliance Checklist

### Section 2: Primitive Types

- [ ] **2.1 Integral Types**: All 8 types (U8-I64) implemented correctly
  - [ ] Correct sizes (1, 2, 4, 8 bytes)
  - [ ] Proper signed/unsigned handling
  - [ ] Range validation

- [ ] **2.2 Floating Point Types**: F16, F32, F64 implemented
  - [ ] IEEE 754 compliance
  - [ ] Correct sizes (2, 4, 8 bytes)
  - [ ] Endianness handling

### Section 3.1: Structures

- [ ] **Packed Structures**: `packed: true` support
  - [ ] 1-byte alignment enforced
  - [ ] No padding between fields
  - [ ] Correct size calculation

- [ ] **Aligned Structures**: Default behavior
  - [ ] Natural alignment per field type
  - [ ] Padding insertion correct
  - [ ] Size rounded to alignment

- [ ] **Custom Alignment**: `aligned: N` support
  - [ ] Custom alignment value applied
  - [ ] Padding calculation correct

### Section 3.2: Arrays

- [ ] **3.2.1 Fixed-Size Arrays**: Compile-time constant sizes
  - [ ] 1D, 2D, 3D+ arrays supported
  - [ ] Row-major ordering
  - [ ] Correct size calculation

- [ ] **3.2.2 Variable-Size Arrays (FAMs)**:
  - [ ] Single FAM at end of struct
  - [ ] Multiple interleaved FAMs
  - [ ] Offset calculation for post-FAM fields
  - [ ] Runtime size calculation

- [ ] **3.2.3 Multi-Dimensional FAMs**:
  - [ ] Row-major ordering preserved
  - [ ] Correct size calculation
  - [ ] Field reference resolution

### Section 3.3: Enums

- [ ] **External tag references**: All path types supported
  - [ ] Sibling field references
  - [ ] Parent/nested field references
  - [ ] Dot-notation path resolution

- [ ] **Tag validation**:
  - [ ] Valid tag values accepted
  - [ ] Invalid tag values rejected
  - [ ] Gap handling in tag values

- [ ] **Variant sizing**:
  - [ ] Size = max(all variants)
  - [ ] Correct variant access by tag

### Section 3.4: Unions

- [ ] **Memory layout**:
  - [ ] All fields at offset 0
  - [ ] Size = max(variant sizes)
  - [ ] No tag field present

- [ ] **Access semantics**:
  - [ ] Per-variant constructors
  - [ ] Type-safe access methods

### Section 3.5: Size-Discriminated Unions

- [ ] **Variant selection by size**
- [ ] **Expected-size validation**
- [ ] **FAM support within variants**
- [ ] **Size calculation correctness**

### Section 4: Type References

- [ ] **4.1 FQDN**: Fully qualified names resolved
- [ ] **4.2 Simple names**: Same-package resolution
- [ ] **4.3 Resolution rules**: Correct precedence

### Section 5: Field References

- [ ] **5.1 Field paths**: Dot-notation supported
- [ ] **5.2 Use cases**: Arrays, enums, validation

### Section 6: Size Calculation

- [ ] **6.1 Constant-size types**: Compile-time known
- [ ] **6.2 Variable-size types**: Runtime calculated
- [ ] **6.3 Footprint vs Runtime size**: Both implemented

### Section 7: Alignment Rules

- [ ] **7.1 Natural alignment**: Per-type alignment table
- [ ] **7.2 Packed override**: 1-byte alignment
- [ ] **Trade-offs**: Documented behavior

### Section 8: Validation

- [ ] **8.1 Buffer size**: Checked before access
- [ ] **8.2 Field references**: Values within bounds
- [ ] **8.3 Tag validation**: Enum tags verified
- [ ] **8.4 Nested validation**: Recursive checks

### Section 9: Package System

- [ ] **9.1 Package names**: Reverse-DNS supported
- [ ] **9.2 Imports**: Relative and absolute paths
- [ ] **9.3 Type visibility**: Public types accessible

### Section 10: Wire Format

- [ ] **Example validation**: All spec examples work
- [ ] **Binary compatibility**: Cross-language verified

### Section 11: Constraints

- [ ] **11.1 FAM rules**: Ordering enforced
- [ ] **11.2 Recursive types**: Properly rejected
- [ ] **11.3 Maximum sizes**: Limits documented

---

## Phase 8: Test Infrastructure

### 8.1 Test Organization

```
tests/
├── compliance/
│   ├── primitives/
│   │   ├── integral_types_test.rs
│   │   ├── floating_point_test.rs
│   │   └── endianness_test.rs
│   ├── arrays/
│   │   ├── fixed_arrays_test.rs
│   │   ├── fam_single_test.rs
│   │   ├── fam_multiple_test.rs
│   │   └── multidimensional_test.rs
│   ├── structs/
│   │   ├── packed_test.rs
│   │   ├── aligned_test.rs
│   │   └── custom_alignment_test.rs
│   ├── unions/
│   │   ├── basic_union_test.rs
│   │   └── variant_access_test.rs
│   ├── enums/
│   │   ├── tag_references_test.rs
│   │   ├── tag_validation_test.rs
│   │   └── variant_sizing_test.rs
│   └── integration/
│       ├── nested_structures_test.rs
│       ├── complex_fams_test.rs
│       └── size_discriminated_test.rs
├── cross_lang/
│   ├── c_rust/
│   │   ├── primitives_compat.rs
│   │   ├── arrays_compat.rs
│   │   └── structs_compat.rs
│   ├── c_ts/
│   │   └── (similar structure)
│   ├── rust_ts/
│   │   └── (similar structure)
│   └── three_way/
│       └── round_robin_test.rs
├── property_based/
│   ├── quickcheck_suite.rs
│   ├── random_abi_gen.rs
│   └── invariant_tests.rs
├── ts_tests/
│   ├── compile_test.sh
│   ├── runtime_test.ts
│   └── node_test_runner.ts
└── regression/
    └── known_bugs/
        └── (specific regression tests)
```

### 8.2 Test Utilities

**Binary Comparator:**
```rust
fn compare_binary(a: &[u8], b: &[u8]) -> Result<(), String> {
    if a.len() != b.len() {
        return Err(format!("Length mismatch: {} vs {}", a.len(), b.len()));
    }

    for (i, (byte_a, byte_b)) in a.iter().zip(b.iter()).enumerate() {
        if byte_a != byte_b {
            return Err(format!(
                "Byte mismatch at offset {}: 0x{:02x} vs 0x{:02x}",
                i, byte_a, byte_b
            ));
        }
    }

    Ok(())
}
```

**Size Validator:**
```rust
trait SizeValidator {
    fn validate_size(&self, abi_type: &AbiType) -> Result<(), String>;
}
```

**Random ABI Generator:**
```rust
struct RandomAbiGenerator {
    rng: StdRng,
    max_depth: usize,
    max_fields: usize,
}

impl RandomAbiGenerator {
    fn generate_struct(&mut self) -> StructType { ... }
    fn generate_enum(&mut self) -> EnumType { ... }
    fn generate_array(&mut self) -> ArrayType { ... }
}
```

### 8.3 CI/CD Integration

**GitHub Actions Workflow:**
```yaml
name: Compliance Tests

on: [push, pull_request]

jobs:
  test-c-codegen:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    steps:
      - uses: actions/checkout@v2
      - name: Install C compiler
        run: # ... install gcc/clang
      - name: Run C compliance tests
        run: cargo test --test c_codegen_compliance

  test-rust-codegen:
    # Similar structure for Rust

  test-ts-codegen:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Install Node.js
        uses: actions/setup-node@v2
      - name: Install TypeScript
        run: npm install -g typescript
      - name: Run TypeScript compliance tests
        run: cargo test --test ts_codegen_compliance

  test-cross-language:
    runs-on: ubuntu-latest
    steps:
      - name: Run cross-language binary compatibility
        run: ./tests/cross_lang_tests/run_all_tests.sh

  test-property-based:
    runs-on: ubuntu-latest
    steps:
      - name: Run property-based tests
        run: cargo test --test property_based_suite -- --test-threads=1

  coverage:
    runs-on: ubuntu-latest
    steps:
      - name: Generate coverage report
        run: cargo tarpaulin --out Xml
      - name: Upload to codecov
        uses: codecov/codecov-action@v2
```

---

## Implementation Priority

### High Priority (Core Correctness)

**Week 1-2:**
1. TypeScript compilation tests
2. Basic cross-language binary compatibility (primitives, simple structs)
3. Function compliance tests (footprint, new, from_array)

**Week 3-4:**
4. Advanced cross-language tests (FAMs, enums, unions)
5. Validation and error path testing

### Medium Priority (Robustness)

**Week 5-6:**
6. Edge case testing (boundaries, overflow, limits)
7. Property-based testing framework
8. Complete compliance checklist verification

### Lower Priority (Quality)

**Week 7-8:**
9. Performance benchmarks
10. Code coverage metrics
11. Documentation and regression tests

---

## Success Criteria

### Must Have (Release Blocker)
- ✅ 100% of primitive types pass cross-language tests
- ✅ All struct types (packed/aligned) binary compatible
- ✅ FAMs work correctly across all languages
- ✅ Enums with external tags validated properly
- ✅ TypeScript code compiles without errors
- ✅ All `new()`, `from_array()`, `footprint()` functions tested
- ✅ No known specification violations

### Should Have (Quality Target)
- ✅ Property-based tests pass 10,000+ random cases
- ✅ Code coverage > 80% for codegen modules
- ✅ All edge cases have explicit tests
- ✅ Cross-platform CI passing (Linux, macOS, Windows)
- ✅ Performance benchmarks established

### Nice to Have (Future Work)
- ✅ Code coverage > 90%
- ✅ Fuzzing integration
- ✅ Formal verification for critical paths
- ✅ Automated regression detection
- ✅ Binary size optimization tracking

---

## Appendix A: Test Data Examples

### Simple Types Test Data
```yaml
# tests/compliance_data/primitives.abi.yaml
abi:
  package: "compliance.primitives"
  abi-version: 1

types:
  - name: "AllPrimitives"
    kind:
      struct:
        packed: true
        fields:
          - name: "u8_val"
            field-type: { primitive: u8 }
          - name: "u16_val"
            field-type: { primitive: u16 }
          - name: "u32_val"
            field-type: { primitive: u32 }
          - name: "u64_val"
            field-type: { primitive: u64 }
          - name: "i8_val"
            field-type: { primitive: i8 }
          - name: "i16_val"
            field-type: { primitive: i16 }
          - name: "i32_val"
            field-type: { primitive: i32 }
          - name: "i64_val"
            field-type: { primitive: i64 }
          - name: "f32_val"
            field-type: { primitive: f32 }
          - name: "f64_val"
            field-type: { primitive: f64 }
```

### Complex Types Test Data
```yaml
# tests/compliance_data/complex_types.abi.yaml
abi:
  package: "compliance.complex"
  abi-version: 1

types:
  - name: "ComplexFAM"
    kind:
      struct:
        packed: true
        fields:
          - name: "fixed_header"
            field-type: { primitive: u32 }
          - name: "array_size"
            field-type: { primitive: u16 }
          - name: "dynamic_array"
            field-type:
              array:
                size: { field-ref: ["array_size"] }
                element-type: { primitive: u8 }
          - name: "footer_after_fam"
            field-type: { primitive: u64 }
```

---

## Appendix B: Compliance Test Checklist

Use this checklist to track compliance testing progress:

### Primitives
- [ ] U8: C ✓, Rust ✓, TS ✓
- [ ] U16: C ✓, Rust ✓, TS ✓
- [ ] U32: C ✓, Rust ✓, TS ✓
- [ ] U64: C ✓, Rust ✓, TS ✓
- [ ] I8: C ✓, Rust ✓, TS ✓
- [ ] I16: C ✓, Rust ✓, TS ✓
- [ ] I32: C ✓, Rust ✓, TS ✓
- [ ] I64: C ✓, Rust ✓, TS ✓
- [ ] F16: C ✓, Rust ✓, TS ✓
- [ ] F32: C ✓, Rust ✓, TS ✓
- [ ] F64: C ✓, Rust ✓, TS ✓

### Arrays
- [ ] Fixed 1D: C ✓, Rust ✓, TS ✓
- [ ] Fixed 2D: C ✓, Rust ✓, TS ✓
- [ ] Fixed 3D: C ✓, Rust ✓, TS ✓
- [ ] Single FAM: C ✓, Rust ✓, TS ✓
- [ ] Multiple FAMs: C ✓, Rust ✓, TS ✓
- [ ] Multi-dim FAM: C ✓, Rust ✓, TS ✓

### Structs
- [ ] Packed: C ✓, Rust ✓, TS ✓
- [ ] Aligned: C ✓, Rust ✓, TS ✓
- [ ] Custom alignment: C ✓, Rust ✓, TS ✓

### Unions
- [ ] Basic union: C ✓, Rust ✓, TS ✓
- [ ] Variant access: C ✓, Rust ✓, TS ✓

### Enums
- [ ] Sibling tag ref: C ✓, Rust ✓, TS ✓
- [ ] Nested tag ref: C ✓, Rust ✓, TS ✓
- [ ] Tag validation: C ✓, Rust ✓, TS ✓

### Cross-Language
- [ ] C → Rust: All features ✓
- [ ] C → TS: All features ✓
- [ ] Rust → C: All features ✓
- [ ] Rust → TS: All features ✓
- [ ] TS → C: All features ✓
- [ ] TS → Rust: All features ✓

### Functions
- [ ] footprint(): All types ✓
- [ ] new(): All types ✓
- [ ] from_array(): All types ✓
- [ ] Getters: All types ✓
- [ ] Setters: All types ✓
- [ ] validate(): All types ✓

---

**Document End**
