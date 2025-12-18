# Type Resolution & Dynamic Parameter Reference

This document explains how `TypeResolver` transforms raw YAML schemas into the canonical `ResolvedType` structures consumed by every backend, with particular focus on the dynamic-parameter map that powers IR, builders, and validators.

## Goals of the Resolver

`abi/abi_gen/src/abi/resolved.rs` enforces the architectural guarantees described in `abi/enum-fams.md`:

- **Deterministic layout** — constant offsets and alignments must be known whenever possible.
- **Dynamic parameters** — every runtime-dependent field (counts, tags, payload sizes) must be captured in a structured map so code generators can treat them uniformly.
- **Validation** — illegal schemas (forward references, mismatched size discriminators, unsafe comments) are rejected before code generation begins.

## Key Data Structures

### `ResolvedType`

```rust
pub struct ResolvedType {
    pub name: String,
    pub size: Size,
    pub alignment: u64,
    pub comment: Option<String>,
    pub dynamic_params: BTreeMap<String, BTreeMap<String, PrimitiveType>>,
    pub kind: ResolvedTypeKind,
}
```

- **`size`** distinguishes constant layouts (`Size::Const(u64)`) from variable ones (`Size::Variable(map)`).
- **`dynamic_params`** maps *owners* (field names or variant identifiers) to field-ref paths and their primitive types. For example a struct with `len: u32` and `data: [u8; len]` produces:
  ```text
  {
    "data": { "len": PrimitiveType::Integral(U32) }
  }
  ```
- **`kind`** mirrors the schema but with resolved child types, offsets, and metadata such as `tag_expression` constants.

### `Size::Variable`

When set, the `HashMap<String, HashMap<String, PrimitiveType>>` uses:
- **First key** — the owner (field name for structs, variant name for enums/unions, or `type_name` for arrays).
- **Second key** — fully qualified path relative to that owner (`count`, `payload.len`, `../header.tag`, etc.).
- **Value** — the primitive type of the referenced field (needed to pick the right arithmetic and endianness downstream).

### `FieldOrderTracker`

To prevent undefined layouts, `FieldOrderTracker` ensures any field-reference expression used in size/count math only references earlier siblings (or upwards through `../` paths). Violations yield `ResolutionError::ForwardFieldReference { type_name, field_name, referenced_field }`.

## Resolver Workflow

1. **Collect typedefs** — `TypeResolver::add_typedef` stores every `TypeDef` indexed by name.
2. **Iterative resolution** (`TypeResolver::resolve_all`)
   - Loop until all types resolve or no progress is made.
   - Attempt to resolve each type:
     - Primitive types resolve immediately.
     - Type refs require the referenced type to be resolved already.
     - Structs/unions/enums recursively resolve children, compute offsets, and populate `dynamic_params`.
   - Track missing types to distinguish between “waiting on dependencies” vs “truly unknown”.
   - Detect circular dependencies when no progress is possible and no external types are missing.
3. **Validation hooks**
   - Comments are checked for `*/` to prevent accidental comment termination.
   - Size-discriminated unions are restricted to one per struct and must have `expected_size` matching their payload type.
   - Enums with heterogenous variants automatically become `Size::Variable` so IR/backends never assume a fixed footprint.

## Dynamic Parameter Canonicalization

The resolver stores whatever field-ref path is present during resolution. Later, `ParameterRegistry` (in `codegen/shared/builder.rs`) normalizes these references when constructing IR:

- Owners are canonicalized to `owner.path` (qualifying nested inline structs with `::` separators).
- Alternate aliases are registered so nested IR consumers can reference parameters using either the fully qualified path or a suffix (e.g., `payload.len` and `len` map to the same parameter when unambiguous).
- Synthetic parameters (such as computed enum tags) are inserted with derived names (`<Type>.computed_tag`).

### Naming rules

| Pattern | Meaning |
|---------|---------|
| `field.subfield` | Reference inside an inline struct |
| `../sibling` | Reference to a previously declared field |
| `field[0]` | Reference to array element at index 0 |
| `_typeref_<Type>::field` | Resolver-internal helper for typeref'ed fields; stripped before IR emission |

Runtime consumers (e.g., the reflection `ParamExtractor`) normalize both the canonical `owner.path` and fully qualified aliases that may appear in IR parameters (such as `Type::field.path`). This keeps dynamic parameter lookup working even when backends or IR dumps include type-prefixed owner names.

Backends should never invent new names. Instead, look up `dynamic_params` (or IR parameters) and reuse the canonical strings. The TypeScript backend demonstrates this through `collect_dynamic_param_bindings` (`ts_gen/ir_helpers.rs`).

### Array Element References

Field references can include array element indices (e.g., `hdr.path_bitset.bytes[0]`). The path is stored as segments: `["hdr", "path_bitset", "bytes", "0"]`. When resolving:

1. The resolver walks through struct fields until it reaches an array type.
2. Numeric path segments are parsed as indices and multiplied by element size to compute offsets.
3. Resolution continues into the element type for any remaining path segments.

This enables size expressions like `popcount(bytes[0]) + popcount(bytes[1])` where each `bytes[N]` is resolved to its concrete offset within the parent buffer.

## When to Touch the Resolver

Add logic here when:
- A new schema feature changes how dynamic sizes are expressed.
- You need stronger validation (e.g., enforcing new layout invariants).
- Backends need additional metadata that can only be derived when the full type graph is available.

Avoid mixing backend-specific concerns into the resolver: keep it language-agnostic. If you need new metadata, add fields to `ResolvedType`/`ResolvedField` and plumb them through `TypeResolver`.

## Debugging Tips

- Run `abi analyze -f <abi.yaml> -v` to print every type resolved and surface validation errors immediately.
- Use `abi analyze --print-ir <file>` to ensure the resolver’s dynamic parameters match what the IR builder expects.
- When diagnosing forward-reference errors, inspect `field_positions` ordering in the offending struct; the resolver only allows references to prior fields at the same nesting depth.

## When to Update This Document

Keep this reference current whenever:

- `ResolvedType`, `ResolvedField`, `Size`, or `dynamic_params` definitions change (new fields, renames, semantics).
- The resolver enforces new validation rules or supports new expression/layout patterns.
- Field-reference normalization or parameter naming conventions evolve (affecting how backends consume dynamic params).
- Additional metadata is introduced that backends must honor (offset annotations, alignment semantics, etc.).
