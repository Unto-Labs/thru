# TypeScript Backend & Runtime Manual

This guide covers the structure of the TS emitter (`rpc/abi/abi_gen/src/codegen/ts_gen`) and the generated runtime (`runtime_template.ts`). Use it when extending generators, debugging emitted code, or wiring new features into the JS toolchain.

## Directory Map

| File | Responsibility |
|------|----------------|
| `ts.rs` | High-level generator: injects runtime, iterates over resolved types, stitches builders/methods together. |
| `ts_gen/types.rs` | Emits the main class per type (nested types, getters, param namespaces, registration hooks). |
| `ts_gen/footprint.rs` | Generates IR-backed `footprint`, `footprintIr*`, and `validate` wrappers plus legacy fallbacks. |
| `ts_gen/from_array.rs` | Generates `from_array`/`fromArray` constructors and reader helpers, using the param cache. |
| `ts_gen/new_method.rs` | Emits `static new_*` helpers for constant-size structs/unions (legacy convenience). |
| `ts_gen/union.rs` | Classes for top-level size-discriminated unions and the variant views/constructors they share with unions. |
| `ts_gen/measure.rs` | Emits `(b) => size \| null` measuring functions for values whose own bytes decide their size (variable-size unions and their variants). |
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
   - For a struct consisting of an integer tag and the enum it selects, the selector builder requires constant-size variants. It writes the tag at its declared width and the payload at the enum field offset. A 64-bit tag uses a bigint literal.
   - Enum variant selectors rely on runtime helpers (`__tnCreateVariantSelector`) to enforce allowed tags/payload sizes.
6. **Parameter cache** (`param_cache/extractor.rs`)
   - Generates `__tnComputeSequentialLayout` + `__tnExtractParams` to read dynamic fields exactly once per buffer.
   - Handles derived bindings (computed enum tags) and sequential scans for tail payloads.
   - Supports array element references in field paths (e.g., `hdr.path_bitset.bytes[0]`) by parsing numeric path segments as indices and computing element offsets.

## Output Paths

Package `a.b.c` is written to `<out>/a/b/c/types.ts`. `ts::ts_package_paths`
allocates the directories with the rule shared by every backend
(`shared::package_paths`): packages in sorted order, each directory level
allocated once per (parent, segment), `_` appended to a name already used at
that level ignoring case. So `cases.Foo` and `cases.foo` are `cases/Foo` and
`cases/foo_`, also on a case-insensitive file system, and the relative
imports between packages follow the allocated directories
(`test_ts_package_dirs_never_collide`).

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
- Primitive builder setters use `bigint` for `u64`/`i64` fields, matching generated readers and view setters so 64-bit sentinels cannot be truncated through JavaScript `number`.
- FAM writers convert computed element counts through `primitive_setter_value_expr`, including hybrid layouts with a dynamic type reference after the array. This keeps inferred `u64`/`i64` length fields compatible with their setters.
- Always call `Type.validate(buffer, params)` before returning from `build()`, `buildInto()` or `finish()` (constant struct and tagged-enum builders use `__tnBuilderValidateOrThrow`), so no builder returns bytes `validate` rejects, as Rust builders validate at build.

No constructor returns a value its `validate` rejects: SDU and top-level enum
`new_<variant>` / `newVariant` check the selected payload, a variable-size
union's `newVariant` measures every variant, and a constant union's
`new_<variant>` and `from_array` check every variant's enum tags.

## Size-Discriminated Unions

A top-level size-discriminated union `T` is a class (`union.rs`). Its size is
the value's byte length, which must equal one variant's `expected-size`
(`validate` returns `tn.invalid_size` otherwise; without params the whole
buffer is the value), and the selected variant must validate over exactly
that size (`tn.invalid_variant` otherwise, e.g. an undeclared enum tag in
it); an SDU field of a struct is checked the same way by the struct's walk. `T.Params` holds that size (`T_payload_size`, ABI path
`T.payload_size`), so `footprintFromParams(view.dynamicParams())` is the
value's size; a size no variant has throws.

- `variantDescriptors` (`tag` = declaration index, `payloadSize` = expected
  size), `variantByName(name)`, `variantBySize(size)`;
- `variant()`, `tag()`, `bytes()`, and `as<Variant>()` returning the variant's
  typed view (a number/bigint for primitives, the `T_<variant>_Inner` view for
  inline structs, `Target.from_array(..)` for type-refs) or `null` when another
  variant is active;
- constructors `new_<variant>(value)` (primitive value, view, builder or bytes)
  and `newVariant(name, bytes)`, which reject a payload of the wrong size or
  one the selected variant does not validate (an undeclared inner tag).

## Inline Enums in Arrays and Enum Payloads

An array of inline enums whose variants all have a constant size and whose
tag is a field outside the element (`items: [enum by kind; count]`, jagged or
not) has one element size, the stride (`IrBuilder::for_typescript` emits
`count * switch(tag)`; params are the count and the tag, as in C and Rust).
A zero count selects no variant, so the runtime's `mul` skips the element
side when the count is 0 (an unknown tag with no elements is valid). Other
inline variable-size elements (`{ tag, body: enum by tag }`) are sized by
`<field>.payload_size`. An enum payload that is itself an inline enum is
sized by its own tag. Measuring walks keep counts as bigints and stop at the
first zero-byte element (each later one starts at the same offset with the
same inputs), so `2^64-1` empty elements validate at once. In the TypeScript
IR, fields of packed structs and enum payloads are not rounded up to their
type's alignment. Enum view classes have `__tnCreateView(bytes, {
fieldContext })`, which selects the variant from the context's tag.

## Counts the IR Cannot Express

A struct array counted by comparisons or short-circuit logic
(`u8[(n != 0) && (4 / n)]`) is sized in the TypeScript IR by a derived
`<field>.computed_size` parameter, like a computed enum tag: `__tnPackParams`
evaluates the count from the other params with the checked, short-circuit
emitter, and the extractor and view getters evaluate it the same way
(numbers, `&&`/`||` short-circuit, integer division). A type whose IR still
cannot be built (`sizeof` next to a field reference, say) makes the CLI
fail with `TypeScript codegen cannot represent type '<T>'`, and any other
emitter failure is reported as an error for its package, never a panic.

## Expression Operators

Every `ExprKind` works in an array count and in an enum tag, with the
semantics of the generated C and Rust (`test_ts_every_expression_operator_matches_c_and_rust`
generates all three and compares them). `sizeof(T)` / `alignof(T)` of a
constant-size type are constants (folded in the TypeScript IR and in the
resolved types the emitters read); `sizeof` of a variable-size type (or of
a name that is not a type) evaluates to null in every expression path (the
measuring walk, the param extractor, view getters), so the value is
rejected at validation, as C, Rust and Go report it unsupported. A constant tag
(`tag-ref: 3`) selects its variant in the IR. Counts and tags use checked
u64 arithmetic everywhere: the IR runtime (a right shift by 64 or more, or
any shift of 0, is 0; a non-zero left shift by 64 or more overflows), the
derived parameters, the param extractor, view getters (`__tnCountNumber`,
`__tnTagNumber`) and the measuring walk. `popcount` counts all 64 bits.
Negation overflows unless a = 0, as in C and Rust. Values are read as C
and Rust read them: a signed field is its u64 two's complement (`i8 -1` is
2^64-1, so `n & 3` is 3), every expression over buffer values (the IR
runtime's parameters and tags, the param extractor's sequential counts,
the measuring walk, view getters) is evaluated in checked u64 bigints, and
a value becomes a number only once it is a byte total that fits the
buffer, so u64 values past 2^53 compare exactly. The operator test runs
u64, i8, i32 and i64 operands; the one C/Rust disagreement it records is
`0 ** (2^64 - 1)` (0 in C, an overflow in Rust), where TypeScript matches C.

## Measuring Walk References

The measuring walk (`measure.rs`) resolves a field reference from the
values it has read: the innermost struct first, `..` stepping out one
struct; `__buffer_size` as the bytes available to the struct that reads
it; a fixed array's element (`hdr.bits.1`) from where the walk passed the
array. An inline union's `__tnMeasure(bytes, ctx)` reads references that
leave the union (`["..", "n"]`, a field of the struct around it) from
`ctx`, which the struct's param extractor and `get_<field>()` fill with its
integer fields, as C passes parent params and Rust the view's context.
`get_<field>()` also hands that context to the union view, which passes it
to its variant views (`fieldContext`); a view resolves a `..` reference in a
count or tag from that context (`__tnResolveContextU64`), never from a
field of its own with the same name. A
walk that cannot be built is a codegen error naming the type
(`TypeScript codegen cannot measure ...`), never a walk that rejects every
value.

## Tag Checks

A value's size alone does not check the enum tags inside fixed-size parts
of it (a union variant, a nested struct, an array element). When a type
contains such a tag (`measure::checks_tags`), its `validate` also walks the
bytes (constant-size enum payloads and union variants holding tags included) with the measuring function (`__tnWalkTags`) and fails with
`tn.invalid_tag` when a tag selects no variant, as C and Rust do: a union is
valid only when every variant validates over its bytes. The walk reads
named structs and enums in place (an enum's tag names a field of its holder)
and calls `validate` on other named types. A top-level enum walks with its
params as context (`__tnParamsContext`: `T.kind` becomes `kind`). Codegen
never drops this check: when a type (or an SDU / union variant) holds a tag
and no walk can be built, generation fails with a clean error.

## Top-Level Enums

A top-level enum's tag is a reference its container resolves (`kind` in
`{ kind, value: TopEnum }`), so `T.Params` holds it (`T_kind`, ABI path
`T.kind`) and every read takes it: `validate(bytes, { params })` (an unknown
tag is `tn.ir.invalid_tag`; without params `tn.param_extraction_failed`),
`from_array(bytes, { params })` (null without params), `footprintFromParams`.
The class has `variantDescriptors`, `variantByName`, `variantByTag`,
`variant()`, `tag()`, `as<Variant>()` (primitive payloads by value) and
`dynamicParams()`; when the tag is a plain reference, `new_<variant>(value)` /
`newVariant(name, bytes)` build a value whose params carry that variant's tag.
A top-level enum whose variants share one size still takes its tag as a
param (`IrBuilder::for_typescript` builds its switch), so its `validate`
checks the tag, as C's `T_validate( .., ext, .. )` and Go's
`ValidateTWith` do.
A struct holding the enum by type-ref binds the enum's tag to its own field:
`IrBuilder::for_typescript` passes the call argument from a `<field>.<path>`
param (`value.kind`) that the struct's extractor reads, and `get_<field>()`
reads the enum with it.

Enum tags are u64, so a tag past 2^53 - 1 is emitted as a bigint literal
(`9007199254740993n`) and smaller tags as numbers. Variant descriptors
(`tag: number | bigint`, top-level and `<field>VariantDescriptors`), the IR
switch cases, `variantByTag`, `variant()`, `<field>Variant()`, `newVariant`
params and the param extractor's tag switches all compare tags exactly
(`__tnTagEquals`), so 2^53 and 2^53 + 1 stay distinct, as in C and Rust.

## Unions

Every union class (top level or an inline `T_<field>_Inner`) has
`variantDescriptors` (`tag` = declaration index, `payloadSize` = constant size
or `null`), `variantByName`, `bytes()`, `__tnCreateView(bytes)` and a
`get_<variant>()` per variant over the same bytes (`set_<variant>()` for
primitives). A struct field holding an inline union has `get_<field>()`
returning that view.

A union with a variable-size variant spans its largest variant, every variant
is read over the same bytes, and a buffer validates only if every variant
fits (enum tags inside constant-size variants are checked too).
`T.__tnMeasure(bytes)` (from `measure.rs`) returns that size or `null`.
`IrBuilder::for_typescript` (used by the TypeScript backend only) sizes such a
union by its byte size: `T.payload_size` for a top-level union and
`<field>.payload_size` for a struct field holding one inline or by type-ref;
the struct's param extractor measures the field while scanning. A top-level
one gets `validate` (consumed size; with params, a different payload size is
`tn.payload_size_mismatch`), `from_array`, `dynamicParams`,
`footprintFromParams` (the payload size, no smaller than the largest
constant-size variant) and `new_<variant>(value)` / `newVariant(name, bytes)`,
which take one complete variant and zero-extend it to the size every variant
needs.

## Sizing From Params

For every value that validates, `T.footprintFromParams(view.dynamicParams())`
equals the consumed size (`test_ts_params_footprint_matches_consumed` checks
every compliance case). Besides counts and tags, `IrBuilder::for_typescript`
adds a `<field>.payload_size` parameter (byte size) for fields whose own
bytes decide their size:

- jagged arrays: the elements' byte total. The `sumOverArray` IR node carries
  it as `payloadParam`; validation still walks every element, sizing from
  params reads the parameter. Jagged builders compute it from the fragments.
- enums that are not the struct's last field with a variant sized by its own
  count fields (tail enums already get the resolver's `<field>.payload_size`);
  the variant's own refs leave the params, the tag stays.
- unions with a variable-size variant (see Unions);
- inline variable-size structs, sized by their own count fields
  (`{ n, bytes[n], count }`) or by an enclosing struct's field (`items[..
  count]`); the scan measures them with the enclosing struct's integers in
  scope. In measuring walks each leading `..` steps out one struct before
  the lookup, so `["..", "count"]` never reads the inner struct's own
  `count`, and floats are skipped (only integers feed expressions).

A size expression may read a value that follows variable-size data inside an
earlier struct field (`items[child.count]` with `child = { n, bytes[n],
count }`, inline, named, nested or imported from another package): the scan
measures that field and reads the value on the way (`measure_values_fn`), it
becomes a param (`items_child_count`), and the view's `__tnResolveFieldRef`
falls back to the cached params by ABI path.

The param extractor's sequential scan measures these fields (`measure.rs`),
so later fields' offsets and params follow. A layout reading `__buffer_size`
gets a `buffer_size` param (ABI path `__buffer_size`, C's `buf_sz`, Rust's
`buffer_size`): the extractor sets it to the buffer's length, and sizing from
params evaluates the layout over that many bytes (a 23-byte buffer of 8-byte
entries after a 4-byte header still footprints to 20). Validation keeps using
the buffer's actual length.

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
5. **Tests** — regenerate compliance fixtures (see `rpc/abi/abi_gen/scripts/run_ir_parity_checks.py --language ts`) and, if possible, add targeted unit tests inside `ts_gen` modules.

## When to Update This Document

Revise this manual whenever:

- The TS generator adds/removes modules or reorganizes responsibilities (new builder types, different param cache behavior).
- The embedded runtime template changes semantics (new helpers, altered validation behavior, different polyfills).
- Builder eligibility rules or generated APIs change (e.g., new fluent methods, different validation hooks).
- Field context propagation or cross-package resolution logic changes (new path segment types, different context merging).
- Debugging/testing workflows for TS shift (new preview flags, different compliance setup) so engineers know the latest process.
