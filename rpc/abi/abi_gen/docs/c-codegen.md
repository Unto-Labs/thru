# C Backend Manual

The C backend (`src/codegen/c.rs`, `src/codegen/c_gen/`) writes one `types.h` and one
`functions.c` per package. Generated C is on-chain friendly: no allocation, no stdio, no
assert; it needs `<stdint.h>`, `<stddef.h>`, `<string.h>` (`memcpy`/`memset`/`strcmp`) and GNU
`__attribute__`s (`packed`, `aligned`, `unused`). It builds warning-free with
`-std=c11 -Wall -Wextra -Werror` under clang and gcc.

## Directory Map

| File | Responsibility |
|------|----------------|
| `c.rs` | Orchestration: builds the model (the whole resolved type set), runs the emitter, adds package includes and the IR helpers, writes the files. |
| `c_gen/model.rs` | Layout model: one `Node` per named type and per inline struct/union/enum/SDU/array/enum payload. Computes external inputs, length dependence, internal field reads and params members. |
| `c_gen/emit.rs` | Emits types, params structs, layout walkers, accessors, setters and named-type entry points (incl. `T_init`) from the model. |
| `c_gen/names.rs` | File-scope names: one table per codegen run allocates every generated identifier (see Names). |
| `c_gen/meta.rs` | Variant descriptor tables (`N_variants`, `N_variant_by_name`) and params key tables (`T_param_keys`). |
| `c_gen/runtime.rs` | Shared header definitions (error codes, walker modes, `tn_abi_variant_t`, `tn_abi_param_key_t`; guarded so package headers can include each other) and the static helpers at the top of every `functions.c` (checked arithmetic, little-endian loads/stores, variant lookup). |
| `c_gen/ir_validate.rs`, `c_gen/ir_footprint.rs` | IR-backed `<T>_validate_ir` / `<T>_footprint_ir` (kept for IR parity) and the `analyze --print-*` previews. Neither is declared for a type whose IR is jagged, calls a nested helper without every parameter it takes, or calls (directly or through other calls) a helper taking the buffer size: the bytes left for a nested value are not an IR value. The nested type keeps its own helpers. |
| `c_gen/footprint.rs`, `c_gen/validate.rs` | Legacy math used only by `abi analyze` previews and the type-library gate's root check. |

## Output paths

Package `a.b.c` is written to `<out>/a/b/c` (`types.h`, `functions.c`).
`c::c_package_paths` allocates the directories with the rule shared by every
backend (`shared::package_paths`): packages in sorted order, each directory
level allocated once per (parent, segment), `_` appended to a name already
used at that level ignoring case. So `cases.Foo` and `cases.foo` are
`cases/Foo` and `cases/foo_`, also on a case-insensitive file system, and the
`#include "../.../types.h"` paths between packages follow the allocated
directories (`test_c_package_dirs_never_collide`).

## Model

Every node has a C prefix: the type name for named types, `<Parent>_<field>` for inline
field types, `<Enum>_<Variant>` for enum/SDU payloads, `<Array>_elem` for inline elements.
A node carries:

- `ext`: field references it cannot resolve inside itself. A struct resolves a key whose
  first segment names one of its fields (navigating nested structs and constant array
  indices, e.g. `hdr.path_bitset.bytes.0`); everything else propagates to the parent. An
  enum's tag reference and a payload FAM sized by a header field are both `ext` keys.
- `len_dep`: the layout depends on the bytes available to the value. Size-discriminated
  unions are length dependent; `__buffer_size` resolves at the nearest enclosing struct (or
  the named root) to that struct's own available byte count.
- `internal`: values a struct reads from its own fields to size its children.
- `via`: values a struct reads through a nested struct field when their offset inside
  that field is only known at run time (`child.count` after `child.bytes: [u8; n]`). The
  nested struct's walker reads the value into its own params (an `internal` entry marked
  `exported`; it never sizes the nested struct), and the outer struct uses that member
  (`p->child.count`). This recurses through nested structs (`outer.inner.count`),
  including named types from another package. Rule: a named struct's `T_params_t` holds
  such a member exactly when some type of the codegen run's resolved type set (every
  loaded ABI file and import) reads that field through it. Each package's model builds
  that whole set in resolution order, so every package of one run emits the same
  layout for every type. A package's params can therefore depend on the importers
  generated with it: generate importers and their imports in one run (the CLI does, with
  the include dir) and do not mix the outputs of different runs. A reference the nested
  walker cannot read (e.g. into an enum or union payload) stays `TN_ABI_ERR_UNSUPPORTED`.
- `members`: the `<Node>_params_t` layout: `buf_sz` (if length dependent), ext values,
  internal values, embedded child params (struct fields, enum/SDU variants, variable-size
  union variants), and `tn_bytes` for jagged arrays.
- Arrays: fixed-size elements have a constant stride. Variable-size elements of an array
  not declared jagged (an inline enum whose variants differ in size, selected by an outside
  tag) share one size when it follows from the values the array supplies alone; the
  stride is that size, computed from params, so no `tn_bytes` is needed. Elements whose
  size depends on their own bytes need a jagged array (else `TN_ABI_ERR_UNSUPPORTED`).
  When the stride is 0 (e.g. an inline enum whose variants are all empty structs), every
  element is the same zero bytes with the same inputs, so validation checks one element
  however large the count; no walker or accessor loops over the elements.
  The same holds for a jagged array whose element takes zero bytes: the walker and the
  element locator stop at the first such element (validation needs no bytes for the rest;
  measuring cannot size them), as in the Rust and Go backends.

## Names

Every file-scope identifier (struct tags, typedefs, params structs, public and static
functions, macros, tables, IR helpers) is a node prefix plus a suffix (`T_t`,
`T_params_t`, `S_get_f`, `S_f_TAG_V`). The emitter writes each prefix as a token naming
its node, and `names.rs` allocates the C name of every (node, suffix) key from one table
over the codegen run's whole type set (every package computes the same table, so a
package header and the headers it includes cannot clash either). Order, appending `_`
to a name already taken:

0. the runtime's `tn_*` / `TN_*` names and the standard C names the code uses
   (`uint8_t`, `memcpy`, ...);
1. declared types, sorted by ABI name: the struct tag `T` and `T_t` (same suffix);
2. their inline types (`T_field`, `E_Variant`, `A_elem`) the same way, in declaration
   order;
3. every other name of each type, same type order, in emission order:
   `<prefix><suffix>`.

Struct tags, ordinary identifiers and macros are separate namespaces (a macro clashes
with everything). So a declared `Message_params` keeps its name and `Message`'s params
become `struct Message_params_` / `Message_params_t_`; the inline type of field `bar`
of `Foo` becomes `Foo_bar_` (`Foo_bar__t`) next to a declared `Foo_bar`. Without a
clash every name is the plain `<prefix><suffix>`. Within one type, a convenience
wrapper whose name another accessor of that type already took is still omitted.

## Walkers

Each node has `<N>_tn_walk( data, len, params, mode, &size )` (public for named types so
other packages can call it). Structs lay out fields sequentially through
`<S>_tn_layout(..., upto, offs)`, aligning each field of a non-packed struct and padding
the end to the struct alignment. Modes:

- `TN_ABI_MODE_TRUST`: compute only (accessors on an already validated buffer).
- `TN_ABI_MODE_VALIDATE`: bounds-check every field, check enum tags and SDU sizes,
  validate nested types, enum payloads and every jagged element, and fill params.
- `TN_ABI_MODE_PARAMS`: no buffer; compute the footprint from params.
- `TN_ABI_MODE_INIT`: buffer zeroed by `T_init`; lay out from params like PARAMS and
  store every params value the layout would otherwise read from the buffer.
- `TN_ABI_MODE_MEASURE`: short buffer; compute the size like TRUST, but every value the
  layout reads (counts, tag fields) must lie inside the bytes present, a jagged element must
  start inside them, and no buffer-length check is made. A child that starts past the end
  sees zero bytes. Used by `T_validate` to report the required size.

All offset and size math goes through `tn_checked_{add,sub,mul,pow,shl,align_up}_u64`.
Tags are evaluated as `uint64_t` and compared at full width. Size and tag expressions are
evaluated by `<N>_tn_count` / `<N>_tn_tag`, which every mode calls: division or modulo by
zero and a nonzero negation are `TN_ABI_ERR_EXPR`. `&&` and `||` short-circuit like the
Rust backend: the right operand (and any error it raises) is evaluated only when the left
does not decide the result, and the result is 0 or 1, so `(n != 0) && (4 / n)` is 0 for
`n == 0`.

## Public API

Named type `T`:

- `T_validate( data, len, &consumed )`, `T_from_slice`, `T_from_slice_mut`. On success
  `consumed` is the value's size. On `TN_ABI_ERR_SHORT_BUFFER` it is the required size
  when the bytes present determine it: the type is not length dependent (no
  `__buffer_size`, no size-discriminated union) and every count/tag field the layout reads
  up to its end, and the start of every jagged element, lies within `len`. Otherwise, and
  on every other error, `consumed` is 0.
- `T_params_from_buffer( data, len, &params )`, `T_footprint_from_params( &params, &fp )`,
  `T_footprint(...)`, `T_size( self[, params] )`
- `T_init( buf, buf_sz, &params, &sz )` (see Building a value), `T_param_keys`
- Error codes are the `TN_ABI_ERR_*` macros in `types.h`.
- A union spans its largest variant. Variable-size variants are walked over the same bytes, and
  a buffer validates only if every variant fits in it. `T_params_t` embeds the params of each
  variable-size variant (`sized.len`), so `T_footprint_from_params` sizes the union from them;
  a constant-size variant contributes only its size.

Struct/union `S`, field `f`:

- primitive: `S_get_f`, `S_set_f`
- nested value: `S_get_f` / `S_get_f_mut` return the child view (`<Child>_t *`); when the
  child needs inputs, an `opt_params` out-argument returns its params.
- whole nested value (the TypeScript `set_f( value )`), for an inline struct field, a
  type-ref field of any named type, and union variants of those kinds:
  - constant size: `int S_set_f( S_t * self[, params], <Child>_t const * value )` copies
    the child's bytes (`TN_ABI_ERR_INVALID_ARG` on NULL).
  - variable size: `int S_set_f_bytes( S_t * self[, params], uint8_t const * src, uint64_t n )`
    replaces the value in place. Nothing is shifted: `n` must equal the field's current
    size in the buffer (else `TN_ABI_ERR_BAD_SIZE`) and `src[0..n)` must validate as the
    child, with the inputs the parent supplies (else the validate error, or
    `TN_ABI_ERR_BAD_SIZE` if it is shorter than `n`). Nothing is written on error.

  Both copy raw bytes: a count or tag inside the value that sizes a later field of `S`
  changes that layout, as writing the member directly would. These setters are emitted
  after every other accessor and wrapper, so a name already taken (e.g. a primitive
  field `f_bytes`, or the array setter `S_set_f`) keeps its meaning and the setter is
  omitted.
- array: `S_get_f_len`, `S_get_f_at`, `S_set_f_at` (primitive elements) or
  `S_get_f_at` / `S_get_f_at_mut` (element views, jagged arrays walk earlier elements);
  node level `<S_f>_len`, `_get_at`, `_set_at`, `_at`, `_at_mut`.
- enum: `S_get_f_tag`, constants `S_f_TAG_<V>`, `S_f_as_<V>` / `_mut` (NULL if inactive),
  and `S_f_select_<V>` / `S_f_select_by_name( self, "V" )` when the tag is a plain
  reference to a primitive field of `S`, possibly nested (`kind`, `hdr.kind`). Selecting
  writes that field. A computed tag (`(a + b) & 0xff`) or a tag held by an enclosing type
  has no select helper: write its input fields instead (`T_init` writes them from params).
  `select_by_name` returns `TN_ABI_ERR_BAD_TAG` for an unknown name.
- size-discriminated union: `S_get_f_variant`, `S_f_TAG_<V>` (variant index), `S_f_as_<V>`.

Variant metadata (the TypeScript `<field>VariantDescriptors`): every enum, SDU and union
node `N` (`S_f` for a field, `T` for a named type) has `tn_abi_variant_t const N_variants[]`
with `N_VARIANT_CNT` entries plus a `{ NULL }` sentinel, and
`N_variant_by_name( name )` (NULL if unknown; `strcmp` only). An entry holds the ABI
variant `name`, `tag` (enum tag value; SDU/union variant index, matching `N_TAG_<V>`),
`payload_size` (`UINT64_MAX` when variable; the expected size for SDUs) and the ABI
`payload_type`. A field whose type is a named enum uses that type's table.

Params keys (the TypeScript `ParamKeys`): every named type has
`tn_abi_param_key_t const T_param_keys[]` with `T_PARAM_KEY_CNT` entries plus a
`{ NULL }` sentinel, one per `uint64_t` leaf of `T_params_t`, in member order:

- `member`: C member path (`hdr_count`, `body.Data.len`); `offset` is its
  `offsetof( T_params_t, ... )`.
- `path`: ABI path of the value: the reference key qualified by the path of the type
  that holds the member (`hdr.count`, `items.hdr.count`, `body.tag`). Derived members
  match the TypeScript canonical keys (`body.tag`); `__buffer_size` stands for `buf_sz`
  and `__tn_bytes` for a jagged array's total byte size.
- `input`: 1 when `T_footprint_from_params` / `T_init` read it from the caller (fields
  read for layout, the root's external references and `buf_sz`, jagged byte totals); 0
  when the walker copies it from another member (a child's view of a parent field).

Top-level enums and SDUs expose `T_get_tag` / `T_get_variant` and `T_as_<V>`; enum and SDU
payloads that are primitives get `<P>_get` / `<P>_set`. Accessors of a type that needs
inputs (external references or `buf_sz`) take a `<T>_params_t const *`. A wrapper whose
name would collide with another accessor of the same type is omitted (the node-level API
remains); a clash with another type's name is resolved as described in Names.

## Building a value

The C counterpart of the TypeScript builders (`T.builder()...build()`):

1. Fill the input members of `T_params_t` (`T_param_keys[i].input`): counts, tag fields
   (or the inputs of a computed tag), nested ones such as `body.Data.len`,
   `records.tn_bytes` for jagged arrays, `buf_sz` for length-dependent types.
2. `int T_init( buf, buf_sz, &params, &sz )` sizes the value from params, returns
   `TN_ABI_ERR_SHORT_BUFFER` (with `sz` = the required size, buffer untouched) when
   `buf_sz` is too small, zeroes the first `sz` bytes and writes every field params imply:
   each count or tag field the layout reads, at every nesting level reached from params
   (struct fields, nested structs, the active enum/SDU payload). A value that does not fit
   its field (count 300 for a `u8`) returns `TN_ABI_ERR_OVERFLOW`. This also selects
   the enum variants: the tag fields are written. Not written: jagged array elements and
   fixed-array elements (their params are not part of `T_params_t`), constant-size union
   variants, and computed tags themselves (their input fields are written instead). The
   count fields of variable-size union variants are written; they overlay the same bytes,
   so conflicting params leave the last variant's value.
3. Fill the payload values through the accessors: primitive setters, `as_<V>_mut` views,
   `set_<f>_at`, jagged elements in index order, whole nested values through
   `S_set_<f>( self, value )` / `S_set_<f>_bytes`. `S_set_<f>( self[, params], src, n )`
   exists for an array field `f` with fixed-size elements whose count is a plain integer
   field of `S` (possibly nested, e.g. `hdr.count`): it copies `n` elements
   (`n * elem_size` bytes in ABI layout) from `src` over the array in place. It never
   resizes: a view carries no buffer length, so another count would overwrite or move
   whatever follows (the next element of a jagged array, a later field, a second array
   sharing the count) or write past the end of the buffer. `n` must equal the count
   already in the buffer, else nothing is written and it returns `TN_ABI_ERR_OVERFLOW`
   for a value the count field cannot hold and `TN_ABI_ERR_BAD_SIZE` otherwise. Write
   the count first: `T_init` from params, or, for a jagged element (not described by
   the root's params), `E_init( (uint8_t *)elem, elem_sz, &elem_params, &sz )` on the
   element or its count field's setter, element by element in index order. Arrays sized
   by an expression, by a field of an enclosing type or by a nested field read through
   the nested struct's params (`via`) have no such setter: set the inputs, then use
   `set_<f>_at`.

   Setters that take a size (`S_set_<f>( self, src, n )`, `S_set_<f>_bytes`) only write
   at the size already in place. The setters that still change a value's size are the
   explicit writes of a value the layout reads: a primitive count or tag field's
   `S_set_<f>`, the `select` helpers, a whole-value setter or `set_<f>_at` whose bytes
   hold such a value. Each writes only bytes inside the value; it resizes the value as
   `T_init` with other params would, and must not be used on a value whose bytes are
   followed by data that has to stay put (a jagged element other than the last).
4. `T_validate( buf, sz, &consumed )` is the post-build check (the TypeScript
   `build()` validation): it must return `TN_ABI_OK` with `consumed==sz`.

Without `T_init`, size a zeroed buffer with `T_footprint_from_params` and write the
fields that size later fields first.

## Tests

- `tests/type_library_codegen_gate.rs::type_library_c_codegen_compiles_and_links`
- `tests/c_codegen_tests.rs` (compile, link every declared function, run)
- `tests/compliance_harness_rust` with `--language c`: the runner re-encodes each case
  through the public API into a zeroed buffer, into one filled with the complement of
  the input, and into one set up by `T_init` from the input params only (also checking
  the short-buffer report). It selects enum variants by constant and by name, writes
  arrays again through `S_set_<f>` where it exists (at the count in place, also checking
  that another count is rejected), writes nested values through the
  whole-value setters in the zeroed pass (`S_set_<f>_bytes` after the per-member copy,
  also checking that another size is rejected), checks the variant tables against
  the active variant and payload size, and checks validate (including the required size
  reported for a truncated buffer), params and footprint round trips.

## When to Update This Document

Update this manual when the C public API, the walker modes, the params layout, the
naming scheme or the C test entry points change.
