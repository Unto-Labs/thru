# ABI Reflection Library

The `abi_reflect` library provides runtime reflection capabilities for ABI types, allowing you to parse binary data and get back a recursive structure containing all type information and parsed values.

## Features

- **Type Reflection**: Convert resolved ABI types into serializable reflection structures
- **Binary Parsing**: Parse binary data according to ABI type definitions
- **Recursive Structure**: Get back a complete recursive structure with both type metadata and parsed values
- **Broad Type Coverage**: Handles primitives, structs, unions, enums, arrays, and size-discriminated unions (see _Current Limitations_ for known gaps)

## Semantics and Limits

- **`__buffer_size`** is the number of bytes available to the struct that reads it (the whole buffer at the top level), as in the code generators.
- **Computed-tag enums** (a `tag-ref` that is an expression, unary `bit-not` and `popcount` included) validate: the interpreter derives `<enum>.computed_tag` from the expression over the type's parameters with the parser's u64 tag arithmetic.
- **Unions** carry no tag, so every variant is decoded over the union's bytes (`Value::Union { variants }`) and formatted as an object of variant name to value.
- **Overflow** in size, offset or expression evaluation is an error, never a panic or a wrapped value.
- **`validate_buffer`** checks the IR footprint and then parses the bytes, so structural errors (an SDU payload matching no variant) fail; a non-struct type with dynamic parameters fails with `UnsupportedOperation`.
- **`reflect_instruction`** rejects bytes the decoded root does not cover (`TrailingBytes`), since programs such as the CLOB run every instruction packed into the buffer; `reflect_account` and `reflect_event` still accept spare capacity.
- **Decode limits** (`limits.rs`): 256 levels of nesting, 65,536 values plus 8 per buffer byte per decode, and 2^20 IR evaluation steps per validation (`LimitExceeded`), so zero-byte type graphs cannot expand exponentially.
- Known gaps: a struct whose enum field has a constant size (all variants the same size) does not reflect, and a struct holding a type reference to a variable-size struct with a self-tagged enum fails validation.

The Go port in `sdks/go/abi` matches this crate byte for byte; after changing reflection output, run `sdks/go/abi/scripts/regen-goldens.sh`.

## Usage

```rust
use abi_reflect::{Reflector, ReflectedValue};
use abi_gen::abi::resolved::TypeResolver;
use abi_gen::abi::file::{AbiFile, ImportResolver};

// Load and resolve ABI types
let mut resolver = TypeResolver::new();
let mut import_resolver = ImportResolver::new(vec![]);
import_resolver.load_file_with_imports(&path, false)?;

for typedef in import_resolver.get_all_types() {
    resolver.add_typedef(typedef.clone());
}
resolver.resolve_all()?;

// Create reflector
let reflector = Reflector::new(resolver)?;

// Parse binary data
let binary_data: &[u8] = /* your binary data */;

// Optional: inspect dynamic parameters and validate before parsing
let params = reflector.dynamic_params("YourTypeName", binary_data)?;
println!("Dynamic params: {:?}", params);
reflector.validate_buffer("YourTypeName", binary_data)?;

let reflected = reflector.reflect(binary_data, "YourTypeName")?;

// Access type information
println!("Type: {}", reflected.type_name());
println!("Size: {:?}", reflected.type_info.size);
println!("Alignment: {}", reflected.type_info.alignment);

// Access parsed values
match reflected.get_value() {
    Value::Struct { fields } => {
        for (name, field_value) in fields {
            println!("Field {}: {:?}", name, field_value);
        }
    }
    Value::Primitive(prim) => {
        println!("Value: {:?}", prim);
    }
    // ... other variants
}
```

## Structure

The library provides:

- **`ReflectedType`**: Contains type metadata (name, kind, size, alignment, comment)
- **`ReflectedValue`**: Contains both type information and parsed value
- **`Value`**: Enum representing all possible parsed values
- **`Parser`**: Low-level binary parser
- **`Reflector`**: High-level API for reflection

## Serialization

All reflection structures implement `Serialize` and `Deserialize` from serde, so you can easily convert them to JSON, YAML, or other formats:

```rust
let json = serde_json::to_string_pretty(&reflected)?;
println!("{}", json);
```

### Quick Demo Command

For a fast sanity check from repo root, run `abi-reflect` directly against an ABI:

```bash
cargo run --manifest-path rpc/abi/Cargo.toml -p abi_reflect --bin abi-reflect -- \
  --abi-file rpc/abi/type-library/thru_primitives.abi.yaml \
  --type-name Pubkey \
  --data-file path/to/binary.bin \
  --show-params \
  --pretty
```

Swap `--abi-file`, `--type-name`, or `--data-file` to try other inputs without
changing library code.

## Command-Line Tool

The library includes a command-line binary `abi-reflect` for parsing binary data and printing JSON results:

```bash
# Build the binary
cargo build --release --bin abi-reflect

# Parse binary data
./target/release/abi-reflect \
  --abi-file path/to/types.abi.yaml \
  --type-name YourTypeName \
  --data-file path/to/binary.bin \
  --pretty

# With include directories for imports
./target/release/abi-reflect \
  --abi-file path/to/types.abi.yaml \
  -I path/to/includes \
  --type-name YourTypeName \
  --data-file path/to/binary.bin \
  --pretty
```

### Options

- `--abi-file` / `-a`: ABI file(s) to load (can be specified multiple times)
- `--include-dir` / `-I`: Include directories for resolving imports (can be specified multiple times)
- `--type-name` / `-t`: Type name to parse
- `--data-file` / `-d`: Binary data file to parse
- `--pretty` / `-p`: Pretty print JSON output (default: compact)
- `--values-only` / `-v`: Show only values without type information (cleaner output)
- `--validate-only`: Run IR validation and exit without decoding
- `--show-params`: Print dynamic parameters derived from the buffer before parsing

### Examples

**Full reflection (with type information):**
```bash
./target/release/abi-reflect \
  --abi-file types.abi.yaml \
  --type-name MyType \
  --data-file data.bin \
  --pretty
```

**Values only (clean output):**
```bash
./target/release/abi-reflect \
  --abi-file types.abi.yaml \
  --type-name MyType \
  --data-file data.bin \
  --pretty \
  --values-only
```
