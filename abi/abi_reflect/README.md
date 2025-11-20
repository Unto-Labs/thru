# ABI Reflection Library

The `abi_reflect` library provides runtime reflection capabilities for ABI types, allowing you to parse binary data and get back a recursive structure containing all type information and parsed values.

## Features

- **Type Reflection**: Convert resolved ABI types into serializable reflection structures
- **Binary Parsing**: Parse binary data according to ABI type definitions
- **Recursive Structure**: Get back a complete recursive structure with both type metadata and parsed values
- **Support for All Types**: Handles primitives, structs, unions, enums, arrays, and size-discriminated unions

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
let reflector = Reflector::new(resolver);

// Parse binary data
let binary_data: &[u8] = /* your binary data */;
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

