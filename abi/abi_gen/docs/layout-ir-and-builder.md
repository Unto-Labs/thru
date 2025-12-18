# Layout IR & `IrBuilder` Playbook

All language backends consume the shared layout IR defined in `abi/abi_gen/src/codegen/shared/ir.rs`. This document explains the schema, the builder algorithm, and how to extend either piece safely.

## IR Schema Recap

`LayoutIr` is a JSON/Protobuf-friendly container with a `version` field plus a list of `TypeIr` payloads.

### `TypeIr`

```rust
pub struct TypeIr {
    pub type_name: String,
    pub alignment: u64,
    pub root: IrNode,
    pub parameters: Vec<IrParameter>,
}
```

- `parameters` are fully qualified dynamic inputs (e.g., `Instruction.payload.count`) exposed to runtime evaluators and code generators.

### `IrNode` Variants

| Node | Meaning | Typical Source |
|------|---------|----------------|
| `ZeroSize` | Empty contribution (used for zero-length arrays/FAMs) | FAM count evaluates to 0 |
| `Const` | Compile-time byte count | Fixed structs, primitive fields |
| `FieldRef` | Reads a dynamic parameter | Counts, payload sizes, derived tags |
| `AlignUp` | Aligns the inner node to a boundary | Struct alignments, array element padding |
| `Switch` | Tag-dispatched subtree | Enums, unions, size-discriminated unions |
| `CallNested` | Invokes another type’s IR | Typerefs, inline structs resolved elsewhere |
| `AddChecked` | Checked addition of two nodes | Summing fixed prefix + dynamic body |
| `MulChecked` | Checked multiplication | Array count × element size |

Every node carries `NodeMetadata`:
- `size_expr` — optional label for debugging/diagnostics (e.g., `payload.len`).
- `alignment` — required alignment after executing the node.
- `endianness` — currently `Little` by default; future nodes may override it for big-endian regions.

## `IrBuilder` Workflow

Located in `abi/abi_gen/src/codegen/shared/builder.rs`.

1. **Topological order** — `build_all()` requests a deterministic ordering from `LayoutGraph` and iterates through it so dependencies (typerefs) are available when needed.
2. **Parameter registry** — Each type starts with `ParameterRegistry::from_dynamic(&ResolvedType::dynamic_params)`. The registry:
   - Canonicalizes owner/path combinations.
   - Provides suffix aliases.
   - Generates synthetic entries for computed expressions (e.g., enum tag math).
3. **Node construction** — `node_from_resolved()` delegates to helpers per `ResolvedTypeKind`:
   - **Primitive / constant structs** → `Const` nodes.
   - **Variable structs** → sum of per-field nodes, each wrapped with `AlignUp`. Arrays call `build_array_node_with_prefix`, enums/unions emit `Switch`.
   - **Enums** → `Switch(tag)` with per-variant parameter scopes.
   - **Unions** → synthetic tag parameter + `Switch`, tag values are implicit indices.
   - **Size-discriminated unions** → `Switch` keyed by payload size, synthetic `payload_size` parameter.
   - **Type refs** → `CallNested` + argument list derived from the target type’s parameters.
4. **Checked arithmetic** — Overflow prevention is baked into IR via `AddChecked`/`MulChecked`. Backends must implement equivalent checked math (C uses 128-bit style helpers, Rust uses `u128`, TS leverages `BigInt`).
5. **Parameter export** — After building the root node, `ParameterRegistry::into_parameters()` emits a deduplicated parameter list stored in `TypeIr.parameters`.

## Common Pitfalls

- **Missing dynamic refs** — If a field relies on runtime sizes but the resolver did not populate `dynamic_params`, `IrBuilder` emits `IrBuildError::MissingDynamicRefs`. Fix the schema or resolver before hacking around it.
- **Unsupported expressions** — Only a subset of `ExprKind` maps to IR today (literal, field ref, add, mul). Before adding new expression kinds in schemas, extend `build_expr_ir` and provide equivalent runtime logic in every backend.
- **Typeref arguments** — Forgetting to pass parent parameters to `CallNested` leads to missing data in nested types. Use `collect_callee_arguments()` which reuses the target type’s parameter names automatically.

## Extending the IR

1. **Add new node variants** to `ir.rs`, update `serde` derive attributes, and document them. Include conversions in `serialization.rs` for JSON/Protobuf.
2. **Teach `IrBuilder`** how to emit the new variant. Keep the exhaustive match statements to let the compiler flag unhandled types.
3. **Update runtimes/backends**:
   - C/Rust/TS IR walkers must understand the new node.
   - `runtime_template.ts` (and future runtimes) should evaluate it.
4. **Add unit tests** covering the new shape in `builder.rs` and serialization round-trips.

## Debugging & Inspection

- `abi analyze --print-ir --ir-format json` prints the full IR for every type. Pipes nicely into `jq` for filtering:
  ```bash
  abi analyze -f sample.abi.yaml --print-ir | jq '.types[] | select(.type_name=="Message")'
  ```
- `abi analyze --print-footprint TypeName` dumps the IR-backed footprint helpers. For C/Rust backends that still have legacy code, this also shows the legacy math for parity comparison.
- Enable the `layout_graph_trace` feature (`cargo run --features layout_graph_trace`) to inspect topological ordering decisions.

## Best Practices

- Keep `IrBuilder` pure: no file-system writes or backend-specific assumptions.
- Prefer descriptive `IrBuildError` variants; they feed directly into CLI warnings.
- When adding new schema capabilities, write resolver + IR builder unit tests in tandem to guarantee the metadata is hooked up end to end.

## When to Update This Document

Revise this playbook when:

- The IR schema gains/removes node variants, metadata fields, or serialization formats.
- `IrBuilder` changes its workflow (new parameter registry behavior, additional error modes, different handling for type kinds).
- Checked arithmetic/alignment semantics evolve (e.g., new overflow rules, new node wrappers).
- Runtimes/backends adopt new expectations that future contributors need to honor when extending the IR.
