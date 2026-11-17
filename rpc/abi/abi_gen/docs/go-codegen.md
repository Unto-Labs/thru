# Go Codegen

The Go backend (`src/codegen/go.rs`, `src/codegen/go_gen/`) emits zero-copy
views, validators, dynamic-parameter helpers and builders for every ABI type.
Generated code uses the Go standard library only, builds with
`CGO_ENABLED=0`, passes `go vet` and is `gofmt`-clean. The type-library gate
(`type_library_go_codegen_compiles`), the compliance harness
(`--language go`), `tests/go_codegen_tests.rs` and `tests/differential_fuzz.rs`
are the acceptance tests.

## Output layout and module path

```bash
abi-gen codegen -f program.abi.yaml -i type-library -l go -o gen --go-module example.com/me/gen
```

```
gen/go.mod                       module example.com/me/gen  (go 1.21)
gen/tnabi/runtime.go             package tnabi: errors, checked math, byte sources, metadata
gen/thru/program/token/types.go  package token: ABI package thru.program.token
gen/thru/common/primitives/...   every imported package of the run
```

- One Go package per ABI package, at the package path (`a.b.c` -> `a/b/c`),
  named after the last segment (sanitized; a Go keyword gets a `_` suffix).
  Directory segments keep `[A-Za-z0-9_-]` (anything else becomes `_`; a
  segment starting with `_` or `-`, which the go tool ignores, gets an `x`
  prefix). Distinct packages always get distinct directories, also on a
  case-insensitive file system: in sorted package order a directory already
  taken (ignoring case) at its level gets `_` appended (`cases.Foo` ->
  `cases/Foo`, `cases.foo` -> `cases/foo_`); `go::package_dirs` is the map,
  built on `shared::package_paths`, the rule every backend uses. The
  runtime's directory is reserved: an ABI package `tnabi` is generated into
  `tnabi_/` (package `tnabi_`).
- One shared runtime package, `tnabi`, per output root. Every package imports
  it as `<module>/tnabi`, and other ABI packages as `<module>/<a>/<b>/<c>`
  (aliased `tnp_a_b_c`; each file allocates one name per imported package in
  sorted order, appending `_` on a clash, so `a.b_c` and `a_b.c` are
  `tnp_a_b_c` and `tnp_a_b_c_`), so errors and metadata types are shared across
  packages (`var e *tnabi.AbiError; errors.As(err, &e)` works for all of them).
- `--go-module` sets the module path (default `abigen`). To vendor the output
  inside an existing module, pass that module's import path of the output
  directory (`--go-module github.com/me/app/internal/abi`) and delete the
  generated `go.mod`; or keep it and add a `replace` directive.
- Generate importers and their imports in one run (the CLI does, with `-i`):
  a package's walkers call those of the packages it imports.

## Pipeline

| Module | Role |
|--------|------|
| `go.rs` | Orchestration: `go.mod`, the runtime, `types.go` per package, imports, type aliases, a gofmt-equivalent layout pass (`gofmt_lite`). |
| `go_gen/emit.rs` | `GoEmitter`: views, walkers (`TnLayout`, `TnInit`, `TnValidate`), expressions, constructors, params, variant metadata, accessors. |
| `go_gen/builder.rs` | Builders (port of `rust_gen/emit_builder.rs`). |
| `go_gen/code.rs` | Statement builder: Go has no `?`, so every fallible step is a statement returning early and expressions compose through temporaries. |
| `go_gen/names.rs` | Go identifiers (exported names, method-name allocation, package names). |
| `go_gen/runtime_template.go` | The `tnabi` runtime. |

The backend reuses the Rust backend's layout model (`rust_gen/model.rs`) and
shape analysis (`rust_gen::emit::Emitter`: slots, shapes, parameters, open
slots, deep validation, variant metadata). Layouts, parameters and errors are
therefore decided by the same code as Rust, and the Go walkers mirror the Rust
walkers statement by statement (`emit_walk_body`, `emit_validate_fn`,
`path_off`, `expr_code`): checked `uint64` offsets (no `int` overflow
differences), full-width tags, nested and `..` references, references to a
nested field after variable data, `__buffer_size`, signed fields
sign-extended then read as u64 two's complement, checked u64 semantics for
all 28 operators (`&&`/`||` short-circuit, overflow, underflow and non-zero
negation rejected, `Pow` exact over the full u64 exponent), zero-size array
elements checked once, unions spanning their largest variant with every
variant validated, and the measured short-buffer size (`tnabi.Measure`).

## Generated API

Names: a type `T` (ABI name exported: `point` -> `Point`; inline types
`T_field_...`), fields and variants in CamelCase (`type_slot` -> `TypeSlot`).
Per-view method names are allocated in a fixed order and get a `_` suffix on a
clash (`Bytes` is taken by the view, so a field `bytes` reads `Bytes_()`).

Package-level names (types and every generated helper: `T__Ext`, `TParams`,
`TBuilder`, `ParseT`, `T<F>Ref`, tag constants, tables, IR helpers, ...) come
from one table per package (`go_gen/pkgnames.rs`), so they never clash. The
rule, appending `_` to a taken name: (1) declared types sorted by ABI name
(`Foo` before `foo`, which becomes `Foo_`); (2) their inline types; (3) each
type's helpers in a fixed order. A declared type therefore keeps its name, and
a helper that would clash with one gets the suffix: with a declared
`MessageBuilder`, the builder of `Message` is `MessageBuilder_`
(`tests/go_fixtures/name_clashes.abi.yaml`). Tools deriving names use
`GoEmitter::vnames_of` / `slot_names`. Not covered: a declared type whose name
equals an inline type's (`A_b` and field `b` of `A`) collides in the shared
layout model, as in the Rust backend.

### Views

- `type T struct { b []byte; ext T__Ext }` - a view aliasing the bytes, so
  setters write through. `T__Ext` holds the values `T` reads from its
  enclosing type (empty for most types).
- `ParseT(b []byte) (T, error)`, `ValidateT(b []byte) (int, error)` (consumed
  bytes), `UncheckedT(b []byte) T`; views that need context:
  `ParseTWith(b, T__Ext{...})`, `ValidateTWith`, `UncheckedTWith`.
- `TFootprint` (const) for constant-size types.
- Methods: `Bytes()`, `Context()`, `Size() int`, `Check() (int, error)`,
  `DynamicParams() (TParams, error)`.
- `T__Ext` methods `TnLayout`, `TnInit`, `TnValidate`, `TnWrap` are the walker
  entry points other generated packages call; they are exported for that, not
  for general use.

### Field accessors (field `f`, Go base `F`)

| Field | Methods |
|-------|---------|
| primitive | `F() T`, `SetF(v T) error` (`f16` is its raw `uint16`) |
| array | `FLen() uint64`, `FBytes() []byte`, `FAt(i uint64) (E, bool)`, `SetFAt(i, v) error`; primitive elements `SetF(values []E) error`; byte arrays `F() []byte`; view elements `FAt` returns the element view, `SetFAt(i, view)` copies one of the same size |
| nested value | `F() C` (child view), `SetF(encoded []byte) error` (same size) |
| enum / SDU | `FTag() uint64` (SDU: `uint8` variant index), `F() TFRef`, `FAs<V>() (P, bool)`, `SetFAs<V>(v) error` (primitive payloads, active variant only), `FBody() []byte`, `SetFBody(b []byte) error` |

`TFRef` is `struct { Tag uint64; Known bool; <V> P ... }`: `Known` when the tag
selects a declared variant, and only that variant's field is set (a view, a
primitive or `[]byte`). Switch on `Tag` with the tag constants.

Top-level arrays, enums and SDUs (the view is the value) use `Len`, `At`,
`SetAt`, `SetAll`, `ElementsBytes`, `Tag`, `Variant() TRef`, `As<V>`,
`SetAs<V>`, `Body`, `SetBody`. A top-level SDU validates only when the buffer
size is one variant's size (`KindInvalidSize`). Union variants are fields at
offset 0.

### Variant metadata

- `T<F>Tag<V>` constants (`uint64`; `uint8` variant indices for SDUs), e.g.
  `ProofBodyTagExisting`; the view's own value: `TTag<V>`.
- `T<F>Variants []tnabi.VariantInfo` (`Name`, `Tag`, `PayloadSize` or
  `tnabi.VariableSize`, `PayloadType`), `T<F>VariantByName(name)`,
  `T<F>VariantByTag(tag)`; unions get `TVariants` (tag = declaration index).

### Params

`TParams` exists for the same types as the Rust `<T>Params`: root structs
(referenced length/tag fields, `<Field>PayloadSize` for a field whose size its
own bytes decide - ABI path `<field>.payload_size` - and `BufferSize` for
`__buffer_size`), top-level SDUs (`Variant`), unions with variable-size
variants (`PayloadSize`), and named views with context (`TParams = T__Ext`).

- `TParamsFromBuffer(b) (TParams, error)`, `TParamsFromValues(...)`,
  `TParamsKeys []tnabi.ParamKey` (Go field, ABI path), `p.Keys()`,
  `p.Get(key) (uint64, bool)`, `p.Set(key, v) bool` (key = Go field or ABI
  path), `p.Footprint() (uint64, error)`.
- `NewT(buf, <typed params>) (int, error)`, `InitT(buf, *TParams) (int, error)`
  (zero-fills the value's bytes and writes every length/tag field the params
  imply), `FootprintT(*TParams) (uint64, error)` (runs the initializer over a
  storage-free `tnabi.Virtual`). For every buffer `b` that validates,
  `TParamsFromBuffer(b).Footprint() == ValidateT(b)`.

### Builders

`NewTBuilder() *TBuilder` for structs, fixed-size unions and arrays, named
top-level SDUs, and top-level enums whose tag is a plain outside reference.
Setters return the builder for chaining and record the first error (a rejected
input leaves the builder unchanged): `SetF(v)`, `SetFBytes(raw)`, `PushF(elem)`,
`SetF([][]byte)` (jagged), `SetF<V>(payload)`, `SetFVariant(tag, payload)`,
`SetFVariantByName(name, payload)`; blob builders `SetEncoding`, `SetAt`;
variant builders `Set<V>`, `SetVariant`, `SetVariantByName`. `Err()` returns
the recorded error. `Build() ([]byte, error)`, `BuildInto(dst) (int, error)`
(writes only the value's bytes), `Finish() (T, error)`,
`DynamicParams() (TParams, error)`.

Count and tag fields that are plain sibling references are filled in. The
checks are the Rust builders': arrays sharing a count must agree, every
variable-size field must span exactly its bytes, the variant set must be the
one the tag selects, and each element given to a jagged array must validate on
its own and decode in place to exactly its bytes (`[0, 1]` + `[42]` for
`VarRecord` is `KindLengthMismatch`).

## Errors and panics

- Every error is a `*tnabi.AbiError{Kind, Needed, Have}`; `Kind` mirrors the
  Rust `AbiError` variants (`Kind.Name()` is the Rust variant name). Sentinels
  `tnabi.ErrInvalidVariant`, ... match with `errors.Is` by kind.
- `KindBufferTooSmall`: `Needed` is the full encoded size when the bytes
  present determine it, otherwise a lower bound, exactly as in Rust
  (`tnabi.RequiredSize(err)`); sizes are relative to the outermost buffer.
- Generated code never panics. Getters on bytes that no longer form a valid
  layout (a zero `T{}`, an `Unchecked` view of bad bytes, or after a setter
  rewrote a length/tag field) read zeros or return `false` / a zero view.
  Setters whose target's offset depends on the bytes lay the value out first
  and, when that fails, write nothing and return the layout error (usually
  `KindBufferTooSmall`): after `SetN(255)` on `{ n: u8, data: u8[n], tail: u8 }`
  bytes `[1, 42, 9]`, `SetTail(7)` fails and leaves the bytes alone. Setters at
  constant offsets still work. `Check()` re-validates. The differential fuzz
  calls every getter on every buffer.

## IR helper functions

From the shared layout IR, for the types the C and Rust backends emit
`<t>_footprint_ir` / `<t>_validate_ir` for (no jagged array; nested calls pass
every parameter of the callee) that call no helper taking the buffer size (a
holder of a `__buffer_size` type: the bytes left for the nested value are not
an IR value, so the holder gets none while the nested type keeps its own),
`go_gen/ir.rs` emits:

- `TFootprintIRChecked(<params> uint64) (uint64, error)` and
  `TFootprintIR(<params> uint64) uint64` (`tnabi.MaxU64` on error). The
  parameters are the IR's, in its order, snake_case as in C and Rust, with
  `bufSz` first when the type uses `__buffer_size`.
- `TValidateIR(bufSz uint64, <params> uint64) (uint64, error)`:
  `KindBufferTooSmall` (`Needed` = the size) when the size exceeds `bufSz`.

Their semantics are the Rust helpers', operator by operator (footprint:
checked expression operators, `KindDivisionByZero`, `KindMissingSwitchCase`;
validator: division by zero and shifts of 64 or more are
`KindArithmeticOverflow`, an unmatched switch `KindInvalidVariant`).
`differential_fuzz::ir_helpers_agree_rust_go_c` compares them with Rust
(exactly) and C on every compliance type.

## Tests

- `cargo test -p thru-abi-gen --test go_codegen_tests`
- `cargo test -p thru-abi-gen --test type_library_codegen_gate type_library_go_codegen_compiles`
  (the type library and `tests/go_fixtures`)
- `cd tests/compliance_harness_rust && ./run_all_tests.sh --language go` - the
  runner re-encodes each case through `Init` + typed setters and through the
  builders, checks `Validate`, the short-buffer size, params, `Keys`/`Get`/`Set`
  and variant re-selection by name.
- `cargo test -p thru-abi-gen --test differential_fuzz` (`ABI_FUZZ_ITERS`
  scales it; includes the IR helper comparison) and `ts_codegen_tests::test_ts_every_expression_operator_matches_c_rust_and_go`.
- Set `ABI_REQUIRE_GO=1` to fail instead of skipping when `go` is missing.

## When to Update This Document

Update when the generated Go API, the runtime package, the output layout or
the module path handling change.
