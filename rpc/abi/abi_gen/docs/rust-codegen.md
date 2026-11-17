# Rust Codegen

The Rust backend (`src/codegen/rust.rs`, `src/codegen/rust_gen/`) emits zero-copy
views, validators, dynamic-parameter helpers and builders for every ABI type. The
compliance harness (`tests/compliance_harness_rust`, `--language rust`) and the
type-library gate (`tests/type_library_codegen_gate.rs`) are the acceptance tests.

## Pipeline

| Module | Role |
|--------|------|
| `rust_gen/model.rs` | Collects a *view* for every named type and every inline struct, union, array element and enum/union variant (an inline enum used as an array element or as another enum's payload is a view too, sized by its tag; in a non-jagged array every such element has the same tag, so the first element's size is the stride, as in the C backend; an inline size-discriminated union there is not supported). Resolves field references exactly like `TypeResolver` (innermost struct scope first, only previously declared fields visible, typerefs and constant array indices traversed). References that land outside a view become that view's context (`<V>__Ext`). Root-owned references become the type's dynamic parameters. A view whose size depends on its own bytes (its own length/tag fields, size-discriminated unions, variable-size unions, `__buffer_size`) is marked `self_dep`; such children get a `<field>_payload_size` parameter in the enclosing struct. |
| `rust_gen/emit.rs` | Emits `types.rs` items and, per view, the layout walker, initializer, deep validator, accessors and `<T>Params` impls. |
| `rust_gen/emit_builder.rs` | Emits builders and `<T>Owned`. |
| `rust_gen/runtime_template.rs` | The runtime (`AbiError`, checked math, `TnBuf`/`TnBufMut`, `TnSub`, `TnVirtual`, `TnLayout`). `abi codegen` writes it once as `<out>/tn_abi_runtime.rs`; each package's `runtime.rs` re-exports it so types from different packages share one error/walker vocabulary. |
| `rust_gen/ir_footprint.rs`, `ir_validate.rs` | IR-derived `<type>_footprint_ir[_checked]` / `<type>_validate_ir` free functions (checked arithmetic; an unmatched switch is an error, never a zero size). Omitted for a type whose IR is jagged or calls a nested helper without every parameter it takes (a union with variable-size variants selects one through a parameter its callers do not supply), as in the C backend. |

`param_cache.rs`, `ir_runtime.rs` and `fat_ptr.rs` are prototypes covered by unit
tests only; generated code does not use them.

## Generated API

For a view `T`:

- `TView<B>` holds the bytes (`&[u8]`, `&mut [u8]` or `Vec<u8>`) plus `T__Ext`.
  Aliases: `T<'a>`, `TMut<'a>`, `TOwned`.
- `T::from_slice`, `T::validate` (returns consumed bytes), `T::from_slice_unchecked`,
  `TMut::from_slice_mut`; views with context use `from_slice_with` / `validate_with`.
  Validation walks nested types, enum payloads, jagged arrays and `__buffer_size`
  arrays; errors are `AbiError`. Array elements of zero bytes (an inline enum
  whose variant is an empty struct) cost one element check however large the
  count: each starts where the previous one did, with the same context, so the
  first stands for all (validation, layout, `f_get(i)`, the params footprint
  and the builders).
- Accessors: `f()` / `set_f(v)` for primitives; byte arrays `f()`, `f_mut()`,
  `set_f(&[u8])`; other arrays `f_len()`, `f_get(i)`, `f_set(i, v)`, `f_get_mut(i)`;
  nested types `f()` / `f_mut()` / `set_f(bytes)`.
- Enums: `f_tag() -> u64` (full width, computed tags included), `f()` returning
  `T{F}Ref` (one arm per variant with a typed view, plus `Unknown(u64)`), `f_mut()`
  returning `T{F}RefMut`, typed `f_as_<variant>()` / `f_as_<variant>_mut()`
  (`Option`, `Some` only for the active variant) and raw `f_body()` /
  `set_f_body()`. Size-discriminated unions expose the same with `f_tag() -> u8`
  (variant index).
- Top-level arrays, unions, enums and size-discriminated unions get views
  (`len/get/set`, per-variant accessors, `tag()/variant()/variant_mut()/body()`,
  `as_<variant>()` / `as_<variant>_mut()`). A top-level size-discriminated union
  validates only when the buffer size equals one variant's size (`InvalidSize`
  otherwise).
- Variant metadata (the TypeScript `*VariantDescriptors`): per enum / SDU field
  `T::<FIELD>_TAG_<VARIANT>` constants (`u64` tags; `u8` variant indices for
  SDUs, matching `f_tag()`), `T::<FIELD>_VARIANTS: &[VariantInfo]` (`name`, `tag`,
  `payload_size`, `payload_type`) and `T::f_variant_by_name(name)` /
  `T::f_variant_by_tag(tag)`. The view's own value uses `TAG_<VARIANT>`,
  `VARIANTS`, `variant_by_name`, `variant_by_tag`; unions get `VARIANTS` (tag =
  declaration index, no `TAG_` constants since a union has no discriminant).
  `VariantInfo` lives in the shared runtime.
- `TParams` (dynamic parameters) exists for:
  - named structs: the referenced length/tag fields, plus `<field>_payload_size`
    (ABI path `<field>.payload_size`, as in TypeScript) for every field whose
    byte size those cannot fix: an enum whose active payload has its own
    length/tag fields, a nested variable-size value whose size its own bytes
    decide, or a jagged array of such values (`T::new(buf, <fields...>)`).
    `new_from_params` zero-fills such a field at the given size, so the result
    has the right footprint; write its contents as raw bytes (or use the
    builder), since typed sub-views would parse the zeros;
  - top-level size-discriminated unions: `{ variant }` (`T::new(buf, variant)`);
  - named unions with variable-size variants: `{ payload_size }` (ABI path
    `payload_size`, the union's byte size: which variant spans it is not
    encoded), so the params footprint is exact; `new_from_params` zero-fills
    that many bytes (`T::new(buf, payload_size)`);
  - named views that read values from outside their bytes, such as a top-level
    enum's tag: an alias of `T__Ext` (`T::new(buf, <inputs...>)`; pass it to
    `from_slice_with`).

  All have `from_values`, `footprint()`, `KEYS: &[(field, ABI path)]`,
  `get(key)` / `set(key, value)` (key = field name or ABI path, like the
  TypeScript `ParamKeys`), `T::new_from_params`, `T::footprint_from_params`
  (runs the initializer over a storage-free `TnVirtual` buffer) and
  `view.dynamic_params()`. When the params hold `buffer_size` (a type using
  `__buffer_size`), `new_from_params` lays the value out over that many bytes
  of the destination, exactly as `footprint_from_params` sizes it, and leaves
  any spare destination bytes untouched (`BufferTooSmall` if the destination
  is shorter); `T::new(buf)` sizes it by the whole destination. Builders'
  `build_into` likewise writes only the value's bytes. The first three kinds
  also have `TParams::from_buffer`,
  and for them `TParams::from_buffer(bytes)?.footprint() == T::validate(bytes)?`
  (`test_rust_params_footprint_roundtrip`).
- `TBuilder`: `set_f` for every field (`set_f_bytes`, `push_f` for arrays,
  only `push_f` when the elements take zero bytes since no encoding carries
  their count, `set_<enum>_<variant>(payload)`, `set_<enum>_variant(tag, payload)` and
  `set_<enum>_variant_by_name(name, payload)` for enums/SDUs), auto-fills
  count/tag fields that are plain references to a sibling, rejects a variant the
  tag does not select, and validates before returning. Every array set must have
  the count written for it (arrays sharing one count field must agree), and
  every variable-size field must span exactly the bytes given for it (a field
  left out spans none), so trailing padding cannot hide a mismatch. Each
  element given to a jagged (or stride) array (`push_f`, `set_f(&[&[u8]])`)
  keeps its boundary: it must validate on its own and decode, in place, to
  exactly its bytes, so `[0, 1]` + `[42]` for `VarRecord { len, data: u8[len] }`
  cannot re-split as `[0]` + `[1, 42]` (`test_rust_jagged_builder_keeps_element_boundaries`);
  `try_build` / `build_into` return `LengthMismatch` and `build` panics with it. `build() -> Vec<u8>`,
  `try_build()`, `build_into(&mut [u8]) -> Result<usize, AbiError>`,
  `finish() -> TOwned`, and `dynamic_params() -> Result<TParams, AbiError>` for
  types with params. Top-level size-discriminated unions (and top-level enums
  whose tag is a plain outside reference) get a variant builder: `set_<variant>`,
  `set_variant_by_name` (and `set_variant(tag, ..)` for enums); an enum builder's
  `dynamic_params()` is the tag its container must store.

## Output paths

Package `a.b.c` is written to `<out>/a/b/c` and is module `a::b::c` of the
output root. `rust_gen::names::rust_package_paths` allocates the paths with
the rule shared by every backend (`shared::package_paths`): packages in
sorted order, each directory level allocated once per (parent, segment), `_`
appended to a name already used at that level ignoring case or reserved
there. So `cases.Foo` and `cases.foo` are `cases::Foo` and `cases::foo_`
(two directories also on a case-insensitive file system), a package named
`tn_abi_runtime` is `tn_abi_runtime_` (the root's shared runtime module keeps
its name), and no package takes `types`, `functions`, `runtime` or `mod`
below the root. A package that is also the parent of another (`a` and
`a.b`) gets one `a/mod.rs` declaring both its own modules (`types`,
`functions`, `runtime`) and its child modules
(`test_rust_parent_package_keeps_its_children`). The `mod.rs` tree, the
`pub use` paths between packages and the runtime re-exports follow the
allocated paths
(`test_rust_package_paths_never_collide`, fixtures in
`tests/package_fixtures`).

## Name hygiene

ABI types may take std prelude names (`Result`, `Option`, `Vec`, `Sized`,
`Default`, `AsRef`, `core`, `alloc`, ...). Emitted code therefore spells std
items in the type namespace by absolute path (`::core::result::Result`,
`::core::option::Option`, `?::core::marker::Sized`, `::core::convert::AsRef`,
`impl ::core::default::Default for ..`, `::core::marker::PhantomData`) and
binds `alloc` privately (`extern crate alloc as __tn_alloc;`,
`__tn_alloc::vec::Vec`, `__tn_alloc::vec!`). `Ok` / `Err` / `Some` / `None` stay
bare: they live in the value namespace, where generated items (type aliases and
braced structs) never appear. Derives resolve in the macro namespace. The
runtime module has no ABI names in scope. New emitter code must follow the same
rule; `test_rust_prelude_named_types` compiles and runs an ABI of such names.
Generated names can still collide with each other (types `Fn` and `FnMut`:
`Fn`'s mutable alias is `FnMut`) or with runtime items (`AbiError`).

## Errors and panics

- `AbiError::BufferTooSmall { needed, have }`: `needed` is the full encoded size
  when the bytes present determine it, otherwise a lower bound (the bytes needed
  to read the next length or tag field). Nested walkers report sizes relative to
  the outermost buffer passed in. `err.required_size()` returns `needed`.
  When a validator's layout walk fails short, it walks the layout again over a
  `TnMeasure` (the counterpart of the C backend's `TN_ABI_MODE_MEASURE`): an
  unbounded source whose reads must still lie inside the bytes present. The
  walk continues past the end of the bytes (a child starting past them sees
  none) as long as every count/tag field it reads, and the start of every
  jagged element, lies inside them; a jagged element of zero bytes, a
  size-discriminated union or a `__buffer_size` reference (`tn_avail` fails on
  a measuring source) leaves the size undetermined. If the measuring walk
  succeeds with an end past `have`, that end is `needed` (equal to the C
  `consumed` on `TN_ABI_ERR_SHORT_BUFFER`); otherwise the first walk's lower
  bound is kept. The Rust walk decides this per input (it reads a field only
  when the layout uses it, and a length-dependent part matters only when
  reached), while C rules out every length-dependent type and reads each
  count/tag field of a laid-out field eagerly, so Rust can also report a size
  where C reports 0. Whenever C reports one, the two agree.
- Builder setters that can reject their input come in pairs: `try_set_*` returns
  `Result<Self, AbiError>` (`LengthMismatch`, `InvalidVariant`, `OutOfBounds`)
  and `set_*` panics with the same error. Setters that cannot fail (primitives,
  variable-size payloads) have no `try_` twin; such payloads are checked by
  `try_build`.
- View accessors that index or take a value list have non-panicking twins:
  `f_try_get(i)` / `f_try_get_mut(i)` (`Option`), `f_try_set(i, v)` and
  `try_set_f(values)` (`Result`); the plain forms panic like slice indexing.
- The remaining panics are documented: `build()` (use `try_build`), and view
  accessors (`tn_expect`) on bytes that no longer form a valid layout, which
  only happens after `from_slice_unchecked` or after a mutable view rewrote a
  length/tag field.

Everything except builders and `TOwned` is `core`-only; builders use `alloc`
(`extern crate alloc` inside the generated module), so the output builds in
`#![no_std]` crates (see `test_rust_generated_code_is_no_std`).

## Tests

- `cargo test -p thru-abi-gen --test rust_codegen_tests` (API parity, top-level
  enums/unions/SDUs, no_std, builders, exact short-buffer sizes)
- `cargo test -p thru-abi-gen --test type_library_codegen_gate type_library_rust_codegen_compiles`
- `cd tests/compliance_harness_rust && ./run_all_tests.sh --language rust` — the
  runner re-encodes each case through `new_from_params` + typed mutable accessors
  and through the builders (a `<field>_payload_size` field is copied as raw
  bytes after `new_from_params`), checks `footprint_from_params` equals the
  case size, checks `required_size()` on a truncated buffer,
  rebuilds params through `KEYS`/`get`/`set`, compares the builder's
  `dynamic_params()`, and re-selects each root enum/SDU variant by name from
  its `VariantInfo`.

## When to Update This Document

Update when the generated API surface, runtime module layout or the reference
resolution rules in `model.rs` change.
