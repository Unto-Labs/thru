# TypeScript Backend & Runtime Manual

This guide covers the structure of the TS emitter (`abi/abi_gen/src/codegen/ts_gen`) and the generated runtime (`runtime_template.ts`). Use it when extending generators, debugging emitted code, or wiring new features into the JS toolchain.

## Directory Map

| File | Responsibility |
|------|----------------|
| `ts.rs` | High-level generator: injects runtime, iterates over resolved types, stitches builders/methods together. |
| `ts_gen/types.rs` | Emits the main class per type (nested types, getters, param namespaces, registration hooks). |
| `ts_gen/footprint.rs` | Generates IR-backed `footprint`, `footprintIr*`, and `validate` wrappers plus legacy fallbacks. |
| `ts_gen/from_array.rs` | Generates `from_array`/`fromArray` constructors and reader helpers, using the param cache. |
| `ts_gen/new_method.rs` | Emits `static new_*` helpers for constant-size structs/unions (legacy convenience). |
| `ts_gen/builder.rs` | Decides which types can expose builders, FAM writers, or enum variant selectors. |
| `ts_gen/param_cache/extractor.rs` | Plans sequential scans that recover dynamic params from buffers. |
| `ts_gen/runtime_template.ts` | Embeddable runtime that interprets the IR, evaluates footprints, validates buffers, and hosts builder utilities. |

## Generation Flow

1. **IR availability** — `cmds/codegen.rs` builds `TypeIr` per type and pairs it with `ResolvedType`. Types missing IR (due to resolver limitations) still generate classes but fall back to legacy math.
2. **Runtime injection** — `ts.rs` prepends the runtime template to each output file, ensuring every module has the same helper functions (`__tnEvalFootprint`, `__tnValidateIrTree`, builder helpers, polyfills).
3. **Type emission** (`types.rs`)
   - Emits nested classes first (`emit_nested_types`) so inline structs/unions have stable names.
   - Writes the primary class with:
     - Buffer/DataView storage
     - Getters/setters
     - `dynamicParams()` exposing cached IR parameters
     - Namespaces for `Params` + `ParamKeys`
     - Optional builder metadata (`flexibleArrayWriters`, variant descriptors)
   - Registers footprint/validate implementations via `__tnRegisterFootprint/Validate`.
4. **Methods** (`footprint.rs`, `from_array.rs`, `new_method.rs`)
   - `emit_footprint_method` emits IR-backed methods that call `__tnFootprintInternal` (which executes the serialized IR). Legacy parity code has been removed; IR is the sole source of truth.
   - `emit_from_array_method` hydrates params using `__tnComputeSequentialLayout` (when necessary), runs validation, and returns an instance with cached params.
   - `emit_new_method` handles only trivial constant layouts; most dynamic builders live in `builder.rs`.
5. **Builders** (`builder.rs`)
   - Supports constant structs, FAM-bearing structs, tagged enums, and tail type-refs.
   - Generated builders expose fluent APIs (`Type.builder().field().set(...)`) and call `Type.validate` before returning buffers or views.
   - Enum variant selectors rely on runtime helpers (`__tnCreateVariantSelector`) to enforce allowed tags/payload sizes.
6. **Parameter cache** (`param_cache/extractor.rs`)
   - Generates `__tnComputeSequentialLayout` + `__tnExtractParams` to read dynamic fields exactly once per buffer.
   - Handles derived bindings (computed enum tags) and sequential scans for tail payloads.
   - Supports array element references in field paths (e.g., `hdr.path_bitset.bytes[0]`) by parsing numeric path segments as indices and computing element offsets.

## Runtime Highlights

`runtime_template.ts` embeds:

- **IR interpreter** (`__tnEvalFootprint`, `__tnValidateIrTree`)
  - Walks `TypeIr` trees using `const/field/add/mul/align/switch/call` nodes.
  - Uses `BigInt` for arithmetic; emits warnings if the host lacks native BigInt/DataView support.
- **Validation facade** (`__tnValidateInternal`)
  - Checks buffer length ≥ footprint, validates tag/switch cases, and enforces argument presence.
  - Returns `{ ok: boolean, code?: string, consumed?: bigint }`.
- **Builder utilities**
  - `__tnResolveStructFieldInput`, `__tnCreateVariantSelector`, `__tnCreateFamWriter` handle common builder patterns (accepting either raw `Uint8Array` or nested builders).
  - `__tnRegisterFootprint/Validate` store per-type callbacks in module-level registries.
- **Polyfills & warnings**
  - Emits warnings once per process when BigInt/DataView polyfills are missing.
  - Keeps the runtime browser-safe by avoiding Node-specific APIs.

## Working with Builders

- Before emitting builder code for a new shape, ensure `supports_*` helpers in `builder.rs` cover it. They perform structural checks (single trailing FAM, primitive-only prefixes, etc.).
- Builders typically allocate via `Type.footprint(params)` and then stream writes through `DataView` helpers.
- Always call `Type.validate(buffer, params)` before returning from `finish()` to guarantee runtime parity with readers.

## Field Context & Cross-Package Type Resolution

When enum variants contain FAM size expressions that reference fields from a parent struct (e.g., `popcount(hdr.path_bitset.bytes[0]) + ...`), the generator:

1. **Collects field refs** — `collect_enum_variant_fam_refs` gathers all field references used in variant FAM size expressions.
2. **Resolves field reads** — `resolve_field_read` in `param_cache/extractor.rs` walks the path segments, handling:
   - Nested struct fields via dot notation
   - Array element access via numeric indices (e.g., `bytes[0]` parses `"0"` as index)
   - TypeRef resolution across packages
3. **Auto-populates context** — Parent struct accessors (e.g., `proof_body()`) automatically read referenced values from the buffer and pass them to inner variant classes via `__tnAutoContext`.
4. **Merges contexts** — Inner classes merge auto-populated context with any user-provided `fieldContext`, allowing manual overrides when needed.

**Cross-package resolution**: The TypeScript generator's `emit_code` accepts an `all_types` parameter containing resolved types from all packages (not just the current one). This enables TypeRef resolution for types like `Hash` from `thru.common.primitives` when generating `state_proof` code.

## Debugging Tips

1. **Generate a single ABI** for inspection:
   ```bash
   abi codegen -f foo.abi.yaml -l typescript -o /tmp/out --verbose
   ```
   Inspect `/tmp/out/<package>/types.ts` around the type of interest.
2. **Use previews**:
   - `abi analyze --print-ir --ir-format json` to see the dynamic parameters and IR nodes the runtime will evaluate.
   - `abi analyze --print-footprint <Type>` to compare legacy vs IR footprint code emitted for TS.
3. **Runtime instrumentation**:
   - Temporary logging can be added to `runtime_template.ts` (since it’s literal string data). Remember to remove or guard with env checks before committing.
4. **Param extraction failures**:
   - Generated code returns `null` when `__tnComputeSequentialLayout` can’t derive all params. This usually means the resolver lacked dynamic references or the schema added a new pattern not yet handled by `param_cache`.

## Adding New Features

1. **Start in the resolver/IR** — ensure the data you need is present in `ResolvedType` and `TypeIr`.
2. **Update helpers** — extend `helpers.rs`, `enum_utils.rs`, or `ir_helpers.rs` if new formatting/aliasing logic is required.
3. **Adjust parameter extraction** — add bindings/derived expressions in `param_cache/extractor.rs` so runtime validation stays in sync.
4. **Emit runtime support** — modify `runtime_template.ts` if the IR walker or builders need new primitives.
5. **Tests** — regenerate compliance fixtures (see `abi/scripts/run_ir_parity_checks.py --language ts`) and, if possible, add targeted unit tests inside `ts_gen` modules.

## When to Update This Document

Revise this manual whenever:

- The TS generator adds/removes modules or reorganizes responsibilities (new builder types, different param cache behavior).
- The embedded runtime template changes semantics (new helpers, altered validation behavior, different polyfills).
- Builder eligibility rules or generated APIs change (e.g., new fluent methods, different validation hooks).
- Field context propagation or cross-package resolution logic changes (new path segment types, different context merging).
- Debugging/testing workflows for TS shift (new preview flags, different compliance setup) so engineers know the latest process.
