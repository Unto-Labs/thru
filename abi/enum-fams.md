Enum + FAM Codegen Requirements
1. Schema & Resolver
Dynamic parameter map: Every type (struct/union/enum) must expose a canonical mapping of dynamic field references (counts, tags, parent paths) so each backend receives identical metadata.
Two-phase IR build: Register type IDs first, then emit IR nodes referencing those IDs. Detect illegal recursion (e.g., FAM size depends on a later field) and reject early.
Field-order validation: Size expressions may reference only fields whose offsets are already determined (siblings above, parent paths). Violations are build-time errors.
   Enums with variants that have different payload sizes must report `Size::Variable`; relying on a constant footprint is incorrect and now rejected in regression tests.
   Size-discriminated unions must provide `expected_size` values that match the actual constant payload size for every variant; mismatches fail during resolution and are covered by regression tests.
2. Layout IR (Shared)
IR nodes carry size_expr, alignment, and endianness metadata.
Support constructs: Const, FieldRef, Switch(tag), AlignUp, CallNested(type_id, params), ZeroSize.
Emit per-variant parameter sets; parameter names are fully qualified (variant.field.path) to avoid collisions.
Provide JSON/protobuf export so future languages share the same contract.
3. Codegen Backends
C
Generate *_footprint(tag, …) and *_validate(buffer, len, tag, …) using IR.
Accessors cache evaluated size expressions, perform overflow-safe arithmetic (double-width multiply), and enforce bounds.
Builders/constructors mirror readers (same footprint math) and reject unknown tags/reserved values.
Inline enum variants (including those embedded inside size-discriminated unions or nested structs) must be materialized as concrete C types with sanitized identifiers so every generated API, setter, or accessor references a real definition instead of opaque byte arrays.
Structs that contain flexible array members keep their leading fixed fields in the emitted definition; only the trailing FAM is treated specially so `offsetof` remains valid for earlier members.
Legacy `*_validate` implementations continue to compute the existing math, but they also call the IR-generated helper with sanitized dynamic parameters, compare bytes-consumed/error codes, and log/assert on mismatches to de-risk the migration.
Footprint and validator entry points now return the IR-calculated sizes by default, with the legacy math kept only for parity assertions and as the fallback when metadata is missing.
`abi analyze --print-validate <Type>` mirrors the footprint preview flow so we can spot-check the emitted legacy wrapper alongside the `*_validate_ir` helper before deleting the old math.
Size-discriminated union wrappers compute their payload size via `offsetof()` and feed it into the IR helpers so those types no longer skip comparison.
Rust
Emit footprint/validate helpers returning u64 or Result<u64, Error>.
Zero-copy readers wrap &[u8], cache dynamic params, and expose safe APIs; unsafe escape hatches remain encapsulated.
Builders use the same IR to size buffers and write aligned payloads.
Rust and C backends share the same IR-first path; generated wrappers must compile cleanly under the compliance harness without requiring extra cfg flags.
Compliance harnesses build test crates with those cfgs so every decode/validate/reencode run exercises the IR helpers and asserts legacy parity before we delete the old math.
 Rust wrappers derive SDU payload sizes and other trailing FAM offsets from `ResolvedField::offset` metadata (no reliance on `_t` C layout types) so pure-Rust builds can feed `*_validate_ir` without linking C headers.
 Normalize resolver-provided dynamic parameter paths against the root struct before emitting getters, ensuring nested references like `second.data.first.count` collapse to real accessors (e.g., `view.first().count()`) and keep IR assertions enabled for deeply nested layouts.
TypeScript
Enum/union classes generated with DataView-based getters, using BigInt internally for 64-bit math.
Static footprint and validate helpers mirror C/Rust logic and now route through the shared IR runtime emitted via `runtime_template.ts` (which also injects lossy-but-guarded BigInt/DataView polyfills for older JS environments).
Writers/builders accept Uint8Arrays and rely on shared IR for offsets/alignment.
Endianness is explicit per field.
`abi analyze codegen --language ts` (and the compliance harnesses that shell out to it) must build the same IR as C/Rust, pass it into the TS generator, and stay self-contained under `abi/abi_gen` (no dependencies on `web/`); this keeps all languages on a single parity path and guarantees the vendored toolchain can run offline.
Generated TypeScript modules read `globalThis.process?.env` for logging/diagnostic knobs so parity checks work in both Node and browser builds even though IR execution is the default.
Public APIs stay ergonomic but expose structured dynamic-parameter objects derived from `TypeIr`:
  • `TokenInstruction.Params` documents every required field (e.g., `accountsCount`, `dataPayloadSize`) and offers helpers such as `Params.fromValues({ accounts, payload })`, `Params.fromBuilder(builderCtx)`, and `view.dynamicParams()`.  Every field is typed (`bigint` when >2^53) and carries doc comments that reference the original ABI path.
  • `static footprint(params: TokenInstruction.Params): number` wraps the IR runtime helpers (`footprintIr`/`footprintIrFromParams`) and clamps to `Number.MAX_SAFE_INTEGER`.  CamelCase convenience helpers (`TokenInstruction.footprintFromParams(...)`, `TokenInstruction.footprintFromValues(...)`) cover the common "I already have the buffers" case.
  • `static footprintIr(...)` / `footprintIrFromParams(...)` expose the IR-only path; builders/readers call these automatically via the param cache.
  • `static validate(buffer, params, opts?)` is IR-first; builders/readers automatically derive the params before calling into it, so decode/validate/reencode flows keep working without manual math.  Options allow forcing extra IR parity assertions or downgrading errors to structured results.
  • Readers expose strongly typed getters plus variant/payload helpers (`view.dataVariant()`, `view.data().asInitializeMint()`), caching the dynamic params internally for reuse.  The cache is immutable, lives next to the `DataView`, and is regenerated whenever `fromArray` succeeds.
  • Builders expose fluent, variant-aware setters (`builder().instruction(...).accounts().write(...).finish().data().select('InitializeMint').writePayload(...).finish().build()`), derive the dynamic params behind the scenes, and size buffers via the shared IR helpers.  They also support `buildInto(buffer)` for zero-allocation paths and emit structured errors when tags/payload sizes are invalid.
  • Flexible array members surface dedicated writer helpers (`builder().proof().write(bytes).finish()`), implemented via a shared runtime cursor so payloads append directly after the fixed prefix and the builder can cache derived counts without manual offset math. Metadata such as `Type.flexibleArrayWriters` advertises which fields expose these writers.
  • `static fromBuilder(builder)` hydrates readers directly from a builder’s cached params/buffer so harnesses can skip redundant parse steps while still performing IR validation.
  • Harness hooks: generated modules export `Type.Params` and `Type.ParamKeys` so the compliance harness can obtain param objects directly from builders/readers without ad-hoc serialization logic.

Example (token program):

```ts
const view = TokenInstruction
  .builder()
  .payload()
  .select("initialize_mint")
  .writePayload(mintPayloadBytes)
  .finish()
  .finishView();
```

Status: `abi analyze codegen --language ts` now emits per-type `__tnExtractParams` helpers, caches the results on every reader instance (`this.__tnParams` + `dynamicParams()`), refuses buffers when extraction fails, exposes camelCase `static footprint*` helpers + IR-first `validate`/`fromArray`, and generates `Type.builder()` scaffolding for both constant layouts and IR-backed tagged enums. The shared runtime walks `TypeIr` during `validate()` and the builder path now wires in `Params.fromValues`, `ParamKeys`, `buildInto`, `finish()/finishView()`, and variant descriptors; remaining work is wiring the TS compliance harness and the reflection runtime to these APIs.
4. Reflection Runtime
Interpreter walks the shared IR, storing parsed field refs in context for later size evaluations.
Tagged unions use tag switches; untagged unions expose helper enums so callers choose variants explicitly.
Validators check tag validity, buffer length ≥ footprint, and per-element bounds (with overflow protection).
5. Validation & Testing
Auto-generate validation functions in all languages (tag range, buffer size, per-index bounds).
Compliance suite includes: zero-length FAMs, nested enums, multi-dim arrays, union-without-tag scenarios, recursion guards.
Property-based tests (Rust proptest, TS fast-check) ensure round-trip correctness; fuzzers use generated Arbitrary builders.
`abi/scripts/run_ir_parity_checks.py --run-harness --skip-previews` batch-runs the compliance harness (C today, Rust/TS tomorrow), writing the JSON summary to `/tmp/harness_logs/compliance_<lang>.log` so we always have a reproducible parity snapshot alongside the CLI previews.
`abi/scripts/run_ir_parity_checks.py` batch-runs `abi analyze --print-footprint/--print-validate` for every compliance ABI and stores the outputs under `/tmp/footprint_logs` + `/tmp/validate_logs` so regressions are easy to diff without re-running dozens of commands by hand.
6. Edge-Case Handling
Endianness: Encoded in IR; every backend honors it.
Zero-length FAMs: Footprint IR emits ZeroSize; validators/constructors allow them.
Alignment: IR includes alignment requirements; TS mimics C padding.
Overflow: Shared helpers use checked math (128-bit in Rust, manual in C, BigInt in TS).
Union context: Generated metadata lists legal variants + optional tag fields; reflection/codegen share the same descriptor.
Schema evolution: Unknown tags return structured errors; builders refuse reserved tags. IR export is versioned.
TS precision: Use BigInt internally, only downcast when safe (< 2^53).
Concurrency: Generated code avoids global mutable caches; all state is per-instance.
Array element references: Field paths can include numeric indices to reference specific array elements (e.g., `["hdr", "path_bitset", "bytes", "0"]`). The resolver walks through struct fields until reaching an array, parses numeric segments as indices, multiplies by element size to compute offsets, and continues resolution into the element type. This enables size expressions like `popcount(bytes[0]) + popcount(bytes[1])`.
Computed enum tags: Enum tag expressions can be arbitrary expressions (e.g., `(type_slot >> 62) & 3`) rather than plain field references. The resolver evaluates these expressions, treats the result as a derived parameter, and populates it automatically during parsing. Builders validate that the derived tag matches the selected variant. TypeScript codegen emits `__tnDerivedParams` and evaluates computed tags via the sequential layout helper.
Popcount expressions: Size expressions can use `popcount(operand)` to count set bits in a field value. This is commonly used for Merkle proof structures where the number of sibling hashes depends on bits set in a path bitset.
Should Do
Maintain a single source of truth (IR + metadata) for all size/offset calculations.
Fail fast on invalid schemas (bad field refs, recursive FAMs, unsupported layouts).
Provide symmetric read/write APIs and shared validation logic across languages.
Document layout contracts and expose tooling (abi analyze --print-ir) for inspection.
Should Not Do
Duplicate arithmetic per backend or hand-code offsets outside the shared IR.
Allow unchecked dynamic allocation or buffer access without validation.
Depend on manual annotations or runtime reflection to discover variant parameters.
Introduce global mutable state or rely on JS number for 64-bit math.
Accept schemas where size expressions reference future fields or where recursion makes layout undefined.
This document defines the contract our toolchain must satisfy to make enums with flexible array members safe, deterministic, and fully portable across C, Rust, TypeScript, and the reflection runtime.
