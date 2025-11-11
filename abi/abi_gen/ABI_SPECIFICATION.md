# Thru ABI Specification

**Version:** 1.0
**Status:** Draft

## 1. Overview

The Thru Application Binary Interface (ABI) defines a type system and serialization format for cross-language data interchange. The ABI provides a compact, deterministic binary representation with support for both fixed-size and variable-size data structures.

### 1.1 Design Goals

- **Zero-copy deserialization**: Structures can be accessed directly from buffers without copying
- **Deterministic layout**: Byte-for-byte reproducible serialization
- **Language agnostic**: Supports C, Rust, TypeScript, and other languages
- **Space efficient**: Packed representations with minimal overhead
- **Type safety**: Strong typing with validation support

### 1.2 Endianness

All multi-byte values are stored in **little-endian** byte order.

## 2. Primitive Types

### 2.1 Integral Types

| Type   | Size (bytes) | Range                    | Description          |
|--------|--------------|--------------------------|----------------------|
| `u8`   | 1            | 0 to 255                 | Unsigned 8-bit       |
| `u16`  | 2            | 0 to 65,535              | Unsigned 16-bit      |
| `u32`  | 4            | 0 to 4,294,967,295       | Unsigned 32-bit      |
| `u64`  | 8            | 0 to 2^64-1              | Unsigned 64-bit      |
| `i8`   | 1            | -128 to 127              | Signed 8-bit         |
| `i16`  | 2            | -32,768 to 32,767        | Signed 16-bit        |
| `i32`  | 4            | -2^31 to 2^31-1          | Signed 32-bit        |
| `i64`  | 8            | -2^63 to 2^63-1          | Signed 64-bit        |

### 2.2 Floating Point Types

| Type   | Size (bytes) | Format        | Description          |
|--------|--------------|---------------|----------------------|
| `f16`  | 2            | IEEE 754-2008 | Half precision       |
| `f32`  | 4            | IEEE 754      | Single precision     |
| `f64`  | 8            | IEEE 754      | Double precision     |

## 3. Composite Types

### 3.1 Structures

Structures are ordered collections of named fields.

#### 3.1.1 Memory Layout

```
┌─────────────────────────────────────┐
│ Field 1 (type T1, offset O1)       │
├─────────────────────────────────────┤
│ Field 2 (type T2, offset O2)       │
├─────────────────────────────────────┤
│ ...                                 │
├─────────────────────────────────────┤
│ Field N (type TN, offset ON)       │
└─────────────────────────────────────┘
```

#### 3.1.2 Packing

**Packed structures** (`packed: true`):
- Fields are placed sequentially with no padding
- Alignment: 1 byte
- Size: Sum of all field sizes

**Aligned structures** (default):
- Fields are aligned to their natural alignment
- Padding inserted between fields as needed
- Total size rounded up to structure's alignment

#### 3.1.3 Example: Packed Timestamp

```
Field Layout:
  seconds: u64 at offset 0 (8 bytes)
  nanos:   u32 at offset 8 (4 bytes)

Total size: 12 bytes
Alignment: 1 byte

Byte representation:
┌──────────────────────┬────────────┐
│  seconds (8 bytes)   │ nanos (4B) │
└──────────────────────┴────────────┘
  0                   7 8          11
```

### 3.2 Arrays

Arrays are fixed or variable-length sequences of elements.

#### 3.2.1 Fixed-Size Arrays

Arrays with compile-time constant size.

```
Layout: [element_0][element_1]...[element_N-1]

Size: element_size × count
```

**Example: Fixed array of u8**
```
[u8; 32] - 32-byte fixed array
┌──┬──┬──┬──┬──┬───┬──┐
│ 0│ 1│ 2│ 3│ 4│...│31│
└──┴──┴──┴──┴──┴───┴──┘
```

#### 3.2.2 Variable-Size Arrays (Flexible Array Members)

Arrays whose size depends on a field value. These are called **Flexible Array Members (FAM)**.

**Size calculation**:
- 1D array: `field_value × element_size`
- Multi-dimensional: `outer_size × (inner_size × ... × element_size)`

**Field References**:
Arrays can reference size values from:
- Simple field names: `["count"]` → refers to `self.count`
- Nested field paths: `["box", "first"]` → refers to `self.box.first`
- Sibling fields in the same structure

**Layout for Single FAM**:
```
┌──────────────────────┐
│ Size field (N)       │  ← Field containing count
├──────────────────────┤
│ Other constant fields│
├──────────────────────┤
│ Element 0            │  ← FAM begins
│ Element 1            │
│ ...                  │
│ Element N-1          │
└──────────────────────┘
```

**Layout for Multiple FAMs and Interleaved Fields**:
FAMs and constant-size fields can be **interleaved** in any order. Once the first FAM appears, all subsequent field offsets become runtime-dependent.

```
┌──────────────────────┐
│ Constant field A     │  ← Offset: 0 (known statically)
├──────────────────────┤
│ FAM 1 (size X)       │  ← Offset: sizeof(A) (known statically)
├──────────────────────┤
│ Constant field B     │  ← Offset: sizeof(A) + runtime_size(FAM1)
├──────────────────────┤
│ FAM 2 (size Y)       │  ← Offset: sizeof(A) + runtime_size(FAM1) + sizeof(B)
├──────────────────────┤
│ Constant field C     │  ← Offset: ...all previous sizes
└──────────────────────┘
```

**Offset Calculation Rules**:
1. **Before first FAM**: All fields have static, compile-time known offsets
2. **First FAM**: Offset = sum of all preceding constant-size fields (static)
3. **After first FAM**: All subsequent fields (FAM or constant) have runtime-calculated offsets
4. **Each field's offset** = sum of all previous fields' sizes (constant sizes are known, FAM sizes are runtime)

**Key insight**: The presence of a FAM makes all subsequent offsets runtime-dependent, even for constant-size fields that follow it.

**Example: Simple FAM**
```
struct Message {
  version: u8          @ offset 0  (1 byte)
  length: u16          @ offset 1  (2 bytes)
  payload: [u8; length] @ offset 3  (length bytes)
}

If length = 5:
┌───┬─────┬──┬──┬──┬──┬──┐
│ver│ len │ 0│ 1│ 2│ 3│ 4│
└───┴─────┴──┴──┴──┴──┴──┘
  0   1  2  3  4  5  6  7
Total size: 8 bytes
```

**Example: Multiple FAMs with Interleaved Constant Fields**
```
struct DynamicBuffer {
  box: { first: u32 }      @ offset 0  (4 bytes, nested struct)
  second: u32               @ offset 4  (4 bytes)
  data: [[u8; second]; box.first]  @ offset 8  (box.first × second bytes)
  data2: [u16; second]      @ offset 8 + size(data)  (second × 2 bytes)
  mycatenum: CatEnum        @ offset 8 + size(data) + size(data2)  (9 bytes)
  catcatcat: u8             @ offset 8 + size(data) + size(data2) + 9  (1 byte)
}

With values: box.first = 3, second = 2
  data size = 3 × 2 = 6 bytes (2D array: 3 rows, 2 bytes per row)
  data2 size = 2 × 2 = 4 bytes (1D array: 2 u16 elements)

Memory layout:
Offset  Field         Size  Type            Description
------  -----------  ----  --------------  ---------------------
0-3     box.first      4   u32 (static)    Value: 3
4-7     second         4   u32 (static)    Value: 2
8-13    data           6   FAM (runtime)   [[0,1], [2,3], [4,5]]
14-17   data2          4   FAM (runtime)   [u16₀, u16₁]
18-26   mycatenum      9   CatEnum (static) Constant-size after FAMs
27      catcatcat      1   u8 (static)     Single byte after FAMs

Total: 28 bytes

Byte-by-byte breakdown:
Bytes   Content
-----   -------
0-3     0x03 0x00 0x00 0x00          box.first = 3
4-7     0x02 0x00 0x00 0x00          second = 2
8       0x00                         data[0][0]
9       0x01                         data[0][1]
10      0x02                         data[1][0]
11      0x03                         data[1][1]
12      0x04                         data[2][0]
13      0x05                         data[2][1]
14-15   0xXX 0xXX                    data2[0] (u16)
16-17   0xXX 0xXX                    data2[1] (u16)
18-26   <9 bytes of CatEnum>         mycatenum
27      0xXX                         catcatcat
```

**Critical observations**:
1. Fields `box` and `second` have **static offsets** (0 and 4)
2. First FAM `data` has **static offset** (8), but **runtime size**
3. Field `data2` has **runtime offset** (8 + runtime_size(data))
4. Fields `mycatenum` and `catcatcat` have **runtime offsets** (depend on both FAMs)
5. Constant-size fields after FAMs still have **runtime-calculated offsets**

#### 3.2.3 Multi-Dimensional FAMs

Multi-dimensional arrays with variable sizes are laid out in **row-major order**.

**Element ordering**: `array[outer][inner]` serializes as:
```
array[0][0], array[0][1], ..., array[0][inner_size-1],
array[1][0], array[1][1], ..., array[1][inner_size-1],
...
array[outer_size-1][inner_size-1]
```

**Size calculation**:
```
[[u8; inner]; outer]
→ Total bytes = outer × inner × sizeof(u8)
→ Total bytes = outer × inner × 1
```

For variable dimensions referencing different fields:
```
struct Matrix {
  rows: u32              @ offset 0  (4 bytes)
  cols: u32              @ offset 4  (4 bytes)
  data: [[u8; cols]; rows]  @ offset 8  (rows × cols bytes)
}

If rows = 2, cols = 3:
┌──────┬──────┬──┬──┬──┬──┬──┬──┐
│ rows │ cols │ [0,0] [0,1] [0,2] [1,0] [1,1] [1,2] │
│  (2) │  (3) │       Row 0      │      Row 1       │
└──────┴──────┴──────────────────┴──────────────────┘
  0   3 4   7 8  9  10 11 12 13
Total: 14 bytes
```

**Nested FAM Arrays**: When the inner array is also variable-sized:
```
data: [[u8; inner_size]; outer_size]

Each row has size: inner_size × element_size
Total size: outer_size × (inner_size × element_size)
```

If both dimensions reference different fields, the size fields must appear **before** the array in memory order.

### 3.3 Enums

Tagged unions where the active variant is determined by a tag field.

#### 3.3.1 Memory Layout

```
┌─────────────────────────────────────┐
│ Tag field (elsewhere in structure)  │  ← Located in parent or sibling field
├─────────────────────────────────────┤
│ Active variant data                 │  ← Size = size of active variant
│ (interpretation depends on tag)     │     (determined by tag value)
└─────────────────────────────────────┘
```

#### 3.3.2 Tag Reference System

Enums in this ABI use **external tag fields** referenced by path, rather than inline tags. The tag field can be:
- A sibling field in the same structure
- A field in a parent structure
- A nested field accessed via path notation

**Tag reference format**: `["field1", "field2", ...]`

**Example 1: Sibling tag field**
```
struct Response {
  status_tag: u8       @ offset 0  (1 byte) ← Tag field
  result: StatusEnum   @ offset 1  (8 bytes) ← Enum references tag via ["status_tag"]
}

enum StatusEnum {
  tag-ref: ["status_tag"]
  variants:
    Ok (tag=0):    u64
    Error (tag=1): u64
}

Total size: 9 bytes (packed)
```

**Example 2: Parent field tag**
```
struct CatEnum {
  tag: u8             @ offset 0  (1 byte) ← Tag field
  body: CatBody       @ offset 1  (8 bytes) ← Enum references parent tag
}

enum CatBody {
  tag-ref: ["tag"]    ← References sibling field
  variants:
    BlackCat (tag=1): u64
    WhiteCat (tag=2): u64
}
```

**Example 3: Nested tag reference**
```
struct Outer {
  inner: {
    tag: u16
  }
  data: DataEnum      ← References nested field via ["inner", "tag"]
}

enum DataEnum {
  tag-ref: ["inner", "tag"]
  variants:
    TypeA (tag=1): u32
    TypeB (tag=2): u64
}
```

#### 3.3.3 Tag Value Matching

**Deserialization process**:
1. Read the tag field value from the referenced path
2. Match tag value against enum variant definitions
3. Deserialize data according to the matched variant's type
4. If tag doesn't match any variant, deserialization fails

**Tag value properties**:
- Must be an integral primitive type (u8, u16, u32, u64, i8, i16, i32, i64)
- Each variant has a unique tag value
- Tag values need not be consecutive
- Gaps in tag values are allowed

#### 3.3.4 Size Calculation

The enum size equals the size of the **active variant**, determined by the tag field value at runtime.

**Important**: Unlike unions which allocate space for the largest variant, enums allocate space only for the active variant. This makes enums a variable-size type when variants have different sizes.

**Example**:
```
enum Message {
  Small (tag=1): u8      (1 byte)
  Medium (tag=2): u32    (4 bytes)
  Large (tag=3): u64     (8 bytes)
}

Size = depends on tag value:
  - If tag == 1: size = 1 byte
  - If tag == 2: size = 4 bytes
  - If tag == 3: size = 8 bytes
```

**Implications for fields following an enum**:
- Fields after an enum have variable offsets based on the active variant
- The offset of following fields must be computed at runtime using the tag value
- This is analogous to flexible array members (FAMs)

### 3.4 Unions

Untagged overlapping fields where only one field is valid at a time.

#### 3.4.1 Memory Layout

```
┌─────────────────────────────────────┐
│ Largest field determines size       │
│ All fields start at offset 0        │
└─────────────────────────────────────┘
```

**Example: Value union**
```
union Value {
  small: u8      (1 byte)
  medium: u32    (4 bytes)
  large: u64     (8 bytes)
}

Size: 8 bytes (size of largest field)
Alignment: 8 bytes (alignment of u64)
```

#### 3.4.2 Access Rules

- All fields share the same memory location
- No tag field provided (untagged union)
- Application must track which field is valid
- Reading wrong field results in reinterpretation of bytes

### 3.5 Size-Discriminated Unions

Unions where the active variant is determined by the **total byte size** of the field rather than an explicit tag value. The deserializer determines which variant to use based on how many bytes are available or consumed.

#### 3.5.1 Memory Layout

```
┌─────────────────────────────────────┐
│ Variant data                        │
│ (size determines interpretation)    │
└─────────────────────────────────────┘
```

Each variant specifies an `expected-size` in bytes. The variant whose expected size matches the actual data size is considered active.

#### 3.5.2 Variant Selection

**Selection algorithm**:
1. Parse/consume bytes according to each variant's type
2. Count total bytes consumed
3. Match consumed bytes against each variant's `expected-size`
4. The variant with matching size is active

**Example: Protocol Message**:
```
size-discriminated-union ProtocolData {
  SmallMessage:  expected-size = 8 bytes
    struct {
      type: u16
      value: u32
      padding: u16
    }

  LargeMessage: expected-size = 16 bytes
    struct {
      type: u16
      value: u64
      extra: u32
      padding: u16
    }
}

If 8 bytes available → SmallMessage is active
If 16 bytes available → LargeMessage is active
```

#### 3.5.3 Use Cases

**1. Variable-size protocol fields**:
```
struct Packet {
  header: u32           (4 bytes)
  data: VariantData     (size-discriminated)
  footer: u16           (2 bytes)
}

The size of 'data' field determines which variant is deserialized.
```

**2. Nested FAMs in variants**:
Size-discriminated unions can contain variants with flexible array members:

```
size-discriminated-union Data {
  FAMVariant: expected-size = 8
    struct {
      count: u8
      items: [u8; count]  ← FAM
    }

  FixedVariant: expected-size = 8
    struct {
      values: [u16; 4]    ← Fixed size
    }
}
```

**When count = 7**:
- FAMVariant size = 1 (count) + 7 (items) = 8 bytes ✓
- Matches expected-size, so FAMVariant is active

#### 3.5.4 Validation

**Size validation rules**:
1. Parse variant data according to its type
2. Calculate total bytes consumed (including any FAMs)
3. Verify: `consumed_bytes == expected_size`
4. If no variant matches the size, deserialization fails

**Important**: The expected-size includes:
- All constant-size fields
- All variable-size fields at their runtime sizes
- Any padding required by packing/alignment

**Error conditions**:
- Available data size doesn't match any variant's expected-size
- Multiple variants have the same expected-size (ambiguous)
- Variant's actual size differs from expected-size (type mismatch)

## 4. Type References

### 4.1 Fully Qualified Domain Names (FQDN)

Types can reference other types using package-qualified names:

**Format**: `package.subpackage.TypeName`

**Example**: `thru.common.primitives.Hash`

### 4.2 Simple Names

Within the same package, types can be referenced by simple name:

**Example**: `Hash` (implies same package)

### 4.3 Resolution Rules

1. Check current package for matching type
2. Check imported packages for matching FQDN
3. Error if type not found or ambiguous

## 5. Field References

### 5.1 Field Paths

Fields can reference values from other fields using dot-notation paths.

**Format**: `["field1", "field2", ...]`

**Example**: Access nested field
```
struct Outer {
  inner: Inner
  count: u32
  data: [u8; inner.size]  ← References Outer.inner.size
}

struct Inner {
  size: u32
}
```

**Path resolution**:
- `["size"]` → `self.size`
- `["inner", "size"]` → `self.inner.size`
- `["parent", "field"]` → traverses up structure hierarchy

### 5.2 Use Cases

Field references are used for:
- **Array sizes**: Dynamic array lengths
- **Enum tags**: Tag field location for enums
- **Validation**: Size or value constraints

## 6. Size Calculation

### 6.1 Constant-Size Types

Types with sizes known at compile time:
- All primitives
- Fixed-size arrays
- Structures with only constant-size fields
- Unions (size = largest variant)

### 6.2 Variable-Size Types

Types with sizes determined at runtime:
- Flexible array members
- Structures containing FAMs
- Enums with variable-size variants

### 6.3 Footprint vs Runtime Size

**Footprint**: Maximum possible size (for allocation)
**Runtime Size**: Actual size of data (for serialization)

**Example**:
```
struct Message {
  type: u8
  length: u16
  data: [u8; length]  ← FAM
}

Footprint: unbounded (depends on max allowed length)
Runtime size: 3 + length bytes
```

## 7. Alignment Rules

### 7.1 Natural Alignment

Each type has a natural alignment:

| Type        | Alignment |
|-------------|-----------|
| u8, i8      | 1 byte    |
| u16, i16    | 2 bytes   |
| u32, i32    | 4 bytes   |
| u64, i64    | 8 bytes   |
| f32         | 4 bytes   |
| f64         | 8 bytes   |
| Arrays      | Element alignment |
| Structs     | Max field alignment |
| Unions      | Max variant alignment |

### 7.2 Packed Override

When `packed: true` is specified:
- Alignment forced to 1 byte
- No padding between fields
- Fields may be misaligned

**Trade-offs**:
- **Advantage**: Smaller serialized size
- **Disadvantage**: Slower access on some architectures

## 8. Validation

### 8.1 Buffer Size Validation

Deserialization must validate that the buffer contains sufficient bytes:

```
For each field at offset O with size S:
  Require: O + S ≤ buffer_size
```

### 8.2 Field Reference Validation

For variable-size arrays referencing field values:

```
Require: referenced_field_value × element_size fits in remaining buffer
```

### 8.3 Tag Validation

For enums, validate tag is within defined range:

```
Require: tag_value ∈ {defined_variant_tags}
```

### 8.4 Nested Type Validation

Validate all nested structures recursively.

## 9. Package System

### 9.1 Package Names

Packages use reverse-DNS style naming:

**Format**: `organization.project.component`

**Examples**:
- `thru.common.primitives`
- `thru.test.advanced`
- `app.blockchain.types`

### 9.2 Imports

Packages can import types from other packages:

```yaml
imports:
  - "common/primitives.abi.yaml"
  - "../../shared/types.abi.yaml"
```

**Import resolution**:
1. Relative to current file
2. Relative to include directories (specified via `-i` flag)

### 9.3 Type Visibility

All types within a package are public and can be referenced by other packages using FQDN.

## 10. Wire Format Example

### 10.1 Complete Example: Transaction

**Type Definition**:
```
package: thru.blockchain

Transaction {
  tx_hash: Hash              @ offset 0  (32 bytes)
  timestamp: Timestamp       @ offset 32 (12 bytes)
  sender: Hash               @ offset 44 (32 bytes)
  receiver: Hash             @ offset 76 (32 bytes)
  amount: u64                @ offset 108 (8 bytes)
}

Hash {
  bytes: [u8; 32]
}

Timestamp (packed) {
  seconds: u64               @ offset 0  (8 bytes)
  nanos: u32                 @ offset 8  (4 bytes)
}
```

**Binary Layout**:
```
Offset  Size  Field           Description
------  ----  --------------  --------------------------
0       32    tx_hash.bytes   Transaction hash
32      8     timestamp.secs  Timestamp seconds
40      4     timestamp.nanos Timestamp nanoseconds
44      32    sender.bytes    Sender address hash
76      32    receiver.bytes  Receiver address hash
108     8     amount          Transfer amount in base units

Total: 116 bytes
```

**Example bytes** (abbreviated):
```
Hex dump:
00000000: a7b3 c9d2 e1f4 5839 2a6b ... 32 bytes  tx_hash
00000020: 0f27 3d5a 0000 0000 ...  8 bytes   timestamp.seconds
00000028: 2c01 0900 ...          4 bytes   timestamp.nanos
0000002c: 3f8a 2b9c 7d1e ... 32 bytes  sender
0000004c: 8e5f 1d3a 6b9c ... 32 bytes  receiver
0000006c: e803 0000 0000 0000      8 bytes   amount (1000)
```

### 10.2 Variable-Size Example: Message

**Type Definition**:
```
Message (packed) {
  version: u8                @ offset 0  (1 byte)
  length: u16                @ offset 1  (2 bytes)
  payload: [u8; length]      @ offset 3  (length bytes)
}
```

**Example: 5-byte payload**
```
Offset  Size  Field           Value
------  ----  --------------  -----
0       1     version         1
1       2     length          5
3       5     payload         [0x41, 0x42, 0x43, 0x44, 0x45]

Total: 8 bytes

Hex dump:
00000000: 01 0500 4142434445
          |  |    |
          |  |    └─ payload (5 bytes)
          |  └────── length = 5
          └───────── version = 1
```

## 11. Constraints and Limitations

### 11.1 Flexible Array Members

- FAMs must appear at the end of structures or be followed only by other FAMs
- Multiple FAMs require careful ordering to maintain deterministic layout
- FAM size fields must be constant-size primitive integers

### 11.2 Recursive Types

Recursive type definitions are not supported. Types cannot directly or indirectly contain themselves.

**Invalid**:
```
LinkedList {
  value: u32
  next: LinkedList    ← Invalid: recursive
}
```

**Valid alternative**: Use external references or indices instead of embedded recursion.

### 11.3 Maximum Sizes

Implementations should define reasonable limits:
- Maximum array size
- Maximum structure nesting depth
- Maximum total message size

## 12. Versioning

### 12.1 ABI Version

Format: `abi-version: 1`

Indicates the version of the ABI specification used.

### 12.2 Package Version

Format: `package-version: "1.2.3"`

Semantic versioning for package contents:
- **Major**: Breaking changes (field removal, type changes)
- **Minor**: Backward-compatible additions (new optional fields)
- **Patch**: Non-functional changes (documentation, metadata)

### 12.3 Compatibility Rules

**Backward compatible changes**:
- Adding new types
- Adding new optional fields at end of structure
- Extending enums with new variants

**Breaking changes**:
- Changing field types
- Changing field order
- Removing fields
- Changing structure packing

## 13. Best Practices

### 13.1 Design Guidelines

1. **Use packed structures** for wire formats to minimize size
2. **Use aligned structures** for in-memory performance
3. **Place variable-size fields last** to simplify layout
4. **Minimize nesting depth** for better cache locality
5. **Use power-of-2 sizes** when possible for alignment

### 13.2 Security Considerations

1. **Validate all sizes** before accessing arrays
2. **Check buffer bounds** before reading fields
3. **Validate tag values** before interpreting enum variants
4. **Limit maximum sizes** to prevent resource exhaustion
5. **Use constant-time comparisons** for sensitive data

### 13.3 Performance Optimization

1. **Align frequently-accessed fields** to natural boundaries
2. **Group related fields** together for cache efficiency
3. **Order fields by size** (largest first) to minimize padding
4. **Avoid deep nesting** of variable-size structures
5. **Use primitive types** instead of single-field wrappers

---

**End of Specification**

**Document History**:
- Version 1.0 (2025-01-11): Initial specification
