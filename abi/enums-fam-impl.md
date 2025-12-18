## Enum + FAM Implementation Plan

This plan turns the requirements in `enum-fams.md` into concrete engineering work across `abi_gen`, `abi_reflect`, and the TypeScript SDK. The objective is to deliver first-class support for enums/unions whose variants contain flexible array members while preserving safety, determinism, and multi-language parity.

---

### 1. Resolver & Metadata Layer (`abi/abi_gen/src/abi`)

1. **Dynamic Parameter Map**
   - [x] Audit `abi/abi_gen/src/abi/resolved.rs` to enumerate all places where `Size::Variable` is produced; document existing assumptions in comments.
   - [x] Introduce a new struct (e.g., `DynamicParams`) and wire it into `ResolvedType`.
   - [x] Implement helper functions (`collect_struct_refs`, `collect_enum_refs`, etc.) that populate fully-qualified field paths; include unit tests with mock types.  
     - [x] Draft an API sketch for each helper (inputs/outputs) and review with senior engineer.  
     - [x] Implement struct-specific collector; add focused unit test.  
     - [x] Implement enum-specific collector; add unit test covering per-variant refs.  
     - [x] Implement union-specific collector; add unit test for untagged unions.  
     - [x] Add a deduplication step so nested collectors don’t double-count the same path (unit test with shared parent refs).  
     - [x] Run `cargo test` and document coverage gaps, if any.
   - [x] Update serialization (if any) and ensure `TypeResolver::get_type_info` exposes the new map.  
     - `ReflectedType` now clones `dynamic_params`, so `abi-reflect` JSON output and CLI consumers receive canonical metadata, and a resolver test asserts `get_type_info` surfaces the map.

2. **Two-Phase IR Build**
   - [x] Create a `LayoutGraph` struct that records nodes and dependencies; unit test with simple schemas.
   - [x] In phase 1, assign an ID to every typedef and record edges for nested references.
   - [x] In phase 2, walk the graph in topological order; when an illegal recursion is detected, return a descriptive `ResolutionError::CircularDependency`.  
     - [x] Implement Kahn’s algorithm utility returning either ordering or offending cycle.  
     - [x] Add logging/trace hooks (behind feature flag) to debug ordering issues.  
     - [x] Write tests proving deterministic ordering even when multiple valid orders exist.  
     - [x] Document the algorithm choice in code comments for future contributors.
    - [x] Wire `IrBuilder::build_all` to consume `LayoutGraph::topo_order`, surfacing cycles via `IrBuildError::DependencyCycle` so the IR phase shares the same two-phase guarantees as the resolver.
   - [x] Write regression tests (one legal recursive reference using parent paths, one illegal forward reference).  
     - Added `allows_recursive_reference_via_nested_struct` and `detects_illegal_forward_reference_cycle` in `layout_graph.rs` to guard the permissive parent-link scenario and ensure forward-only cycles are rejected early.

3. **Field-Order Validation**
  - [x] Extend `collect_field_references_with_context` to track field indexes; compare referenced field positions.  
     - Added a `FieldOrderTracker` path through `resolve_type_kind` so size expressions know the current field index when collecting refs.
  - [x] Add errors for forward references with actionable messages (include type + field names).  
     - New `ResolutionError::ForwardFieldReference` fires with `type_name`, `field_name`, and `referenced_field` when a field reaches forward.
  - [ ] Wire computed enum tag expressions into `FieldOrderTracker` so tags cannot reference forward fields; add regression tests that reject `tag = next_field & 0xFF` but accept back-references needed by `state_proof.abi.yaml`.
   - [x] Update existing YAML fixtures (if needed) to satisfy the new rule; add negative tests under `abi/abi_gen/tests`.  
     - Added unit coverage (`struct_field_forward_reference_error`, `parent_field_reference_allowed`) plus `test_struct_field_forward_reference_rejected` in `tests/integration_tests.rs`; existing fixtures already satisfied the stricter rule.

4. **Resolver Regression Baseline**
   - [x] Update `dependency::dependency_tests::resolved_tests::test_enum_type_resolution` so heterogeneous enums assert `Size::Variable`, matching the new resolver semantics for variant-dependent payloads.
   - [x] Adjust the `TokenAccountUnion` fixture inside the same module so every `expected_size` matches the actual primitive payload, keeping the SDU validation meaningful.
   - [x] Fix `tests/rust_codegen_tests::{test_rust_advanced_types, test_rust_repr_c_attributes}` by adding resolver context stacks + Rust generator repr/lifetime support; `advanced_types.abi.yaml` now complies with the constant-size SDU rule and the Rust harness is fully green.

Deliverables: new resolver tests covering valid/invalid enum/FAM combinations; documentation updates in `ABI_SPECIFICATION.md`.

---

### 2. Shared Layout IR (`abi/abi_gen/src/codegen/shared`)

1. **IR Definition**
   - [x] Create `abi/abi_gen/src/codegen/shared/ir.rs` with enums/structs describing nodes.
   - [x] Ensure every node carries explicit `size_expr` (where applicable), `alignment`, and `endianness` metadata; document defaults.
   - [x] Include derives (`Debug`, `Serialize`, `Deserialize`) and add a schema version field for exports.
   - [x] Document each node with comments and add doctests showing sample IR trees.
   - [x] Build serializer modules that output IR as JSON **and** Protobuf (matching the schema version); add CLI smoke tests for both formats.  
     - JSON serialization is handled via `serde_json`, protobuf serialization now lives in `codegen::shared::serialization`/`ir_proto`, and `abi analyze --print-ir --ir-format json|protobuf` covers the CLI surface.

2. **IR Generator**
   - [ ] Refactor existing footprint code to reusable helpers; ensure old paths still compile during transition.  
     - [ ] Identify duplicated logic (offset accumulation, tag switches, FAM loops) and extract into Rust functions.  
     - [ ] Add temporary adapter layer only if needed during refactor; plan to delete it once tests pass.  
     - [ ] Run `cargo fmt`/`clippy` to ensure the refactor introduces no warnings.  
     - [ ] Add unit tests for each helper before integrating with IR generator.
     - [ ] Add TODOs + lint (`#[allow(dead_code)]` with comment) on adapters so they’re removed once the IR path is default.
   - [x] Introduce `codegen/shared/builder.rs` as the initial `IrBuilder` scaffolding; constant-size types emit `Const` nodes today while variable-size arrays/enums still return structured `IrBuildError::UnsupportedSize`.
   - [x] Extend `IrBuilder` to stream struct dynamic parameters into `FieldRef` + `AddChecked` DAGs (with `AlignUp`), and keep `TypeRef` handled via `CallNested` (unit tests cover primitive, typeref, dynamic struct, and unsupported array cases).
  - [x] Implement generator functions per `ResolvedTypeKind`, returning IR nodes rather than strings.  
    - [x] For each variant (struct/enum/union/array/SDU/typeref), design mapping from resolved metadata to the required node set (`Const`, `FieldRef`, `Switch`, `AlignUp`, `CallNested`, `ZeroSize`, checked arithmetic`).  
    - [x] Implement and test struct/array/enum/union/SDU/typeref mappings; only pathological cases remain TODO.  
    - [x] Add exhaustive matching to catch unhandled type kinds at compile time.  
    - [x] Document assumptions (e.g., enums always provide tag expressions) within code comments.
    - [x] Ensure nested dynamic-parameter maps (inline enums/unions/arrays) are registered with the IR parameter registry so child nodes can reference parent field refs (e.g., `TokenInstruction::payload` tag). `abi/abi_gen/src/codegen/shared/builder.rs` now calls `ParameterRegistry::extend_with` before emitting child nodes, fixing the `TokenInstruction` footprint mismatch (`legacy=13 / ir=3`) and unblocking any enum that draws parameters from sibling fields.
  - [x] Add unit tests covering: simple struct, enum with constant variants, enum with FAM variant, union-without-tag, and a case requiring `AlignUp` + `ZeroSize`.
  - [x] Verify deterministic ordering by comparing serialized JSON across multiple runs (and confirm protobuf serialization bytes remain identical).

3. **Overflow-Safe Arithmetic Nodes**
   - [x] Add `MulChecked`, `AddChecked` IR nodes with metadata (operand references) and emit them for dynamic arrays/FAMs with fully-qualified parameter names.
   - [x] Unit-test conversion of nested multi-dimensional arrays into the correct arithmetic DAG.

Deliverables: unit tests validating IR for representative schemas (simple enum, enum+FAM, union without tag).

---

### 3. Codegen Backends

#### 3.1 C Backend (`abi/abi_gen/src/codegen/c_gen`)

> **Migration strategy:** TypeScript IR codegen is proven correct (31/31 compliance tests, legacy removed). C backend should validate against TypeScript output, not legacy math. Delete legacy code once C output matches TS byte-for-byte.

**Completed scaffolding:**
- [x] `ir_footprint.rs::FootprintIrEmitter` walks `IrNode` and emits C footprint expressions
- [x] `IrValidatorEmitter` emits `*_validate_ir` helpers + forward declarations
- [x] Entry points (`*_footprint`, `*_validate`) are IR-first with legacy as fallback
- [x] Checked arithmetic helpers (`tn_checked_add_u64`, `tn_checked_mul_u64`) in place
- [x] Inline enums/variants receive sanitized C typedefs
- [x] SDU payload sizes computed via `offsetof()` and passed to IR helpers
- [x] Struct layouts preserved even with FAMs (zero-length pad trick)

**Remaining work:**

1. Cross-language parity testing
   - [ ] Add compliance harness mode that compares C footprint/validate results against TypeScript output for the same test case
   - [ ] For each compliance ABI: generate C, run decode/validate/re-encode, compare byte output against TS
   - [ ] Fail tests when C diverges from TS (not when C diverges from legacy)

2. Delete legacy code
   - [ ] Once C matches TS for a type category, remove legacy math for that category
   - [ ] Order: primitives → structs → arrays → enums → unions → SDUs → computed tags
   - [ ] Remove `/* TODO: Handle other field types after FAM */` fallback in `validate.rs`

3. Builders (port from TS patterns)
   - [ ] Emit builder structs mirroring the TS `Type.builder()` pattern
   - [ ] Validate inputs before writing, run buffer-size assertions on completion
   - [ ] Test via cross-language round-trip: build in C, decode in TS (and vice versa)

#### 3.2 Rust Backend (`abi/abi_gen/src/codegen/rust_gen`)

> **Migration strategy:** Same as C—validate against TypeScript, not legacy. TypeScript is the reference implementation.

**Completed scaffolding:**
- [x] `IrBuilder` threaded into `RustCodeGenerator`
- [x] `*_footprint_ir` / `*_validate_ir` emitted, wrappers are IR-first
- [x] Parameter paths normalized (no `std::mem::offset_of!` on `_t` types)
- [x] 31/31 compliance passes under IR cfg toggles

**Remaining work:**

1. Cross-language parity testing
   - [ ] Add compliance harness mode comparing Rust output against TypeScript
   - [ ] For each compliance ABI: generate Rust, run decode/validate/re-encode, compare against TS
   - [ ] Fail tests when Rust diverges from TS

2. Delete legacy code
   - [ ] Once Rust matches TS for a type category, remove legacy math
   - [ ] Replace TODO placeholders in `functions_opaque.rs` with IR-driven math
   - [ ] Order: primitives → structs → arrays → enums → unions → SDUs → computed tags

3. Port TS patterns to Rust
   - [ ] `DynamicParamCache` struct (like TS `this.__tnParams`)
   - [ ] Builder APIs with `with_capacity` constructors using IR footprint
   - [ ] Chained setters mirroring TS fluent builder pattern
   - [ ] Test via cross-language round-trip with TS

#### 3.3 TypeScript Backend (`abi/abi_gen/src/codegen/ts_gen`)

#### Phase 1 – New IR-driven reader surface
- [x] Replace the legacy `ts_gen` modules (`footprint.rs`, `new_method.rs`, `from_array.rs`, `types.rs`) with a single IR-aware emitter that now threads every struct through the shared runtime (`runtime_template.ts`).  The generated classes walk `TypeIr` once, emit the `Params` namespace, and inject the reader template (buffer/view/param cache) directly from the IR metadata.
- [x] Implement `static fromArray(buffer: Uint8Array, opts?) -> Type | null` that hydrates IR parameters via the derived `__tnExtractParams` helpers (or caller-provided `opts.params`), validates via the IR runtime, and only constructs the view when the IR validator succeeds.
- [x] Ensure every getter/setter continues to use `bigint` for 64-bit fields while reusing the new runtime helpers (`__tnToBigInt`, `__tnPolyfill*`) so endianness comments stay intact and the cache is populated exactly once per buffer.

#### Phase 2 – Footprint/validate wrappers and parameter helpers
- [x] Generate `Type.Params` (namespace + helpers) with:
  - strongly typed fields (number/bigint/enum) matching `TypeIr.parameters`,
  - doc comments sourced from the ABI,
  - helper constructors (`params({ ... })`) that coerce inputs to `bigint`.
- [x] Emit the initial `Params` namespace + `footprint_ir_from_params` / `footprint_from_params` / `footprint_from_values` wrappers so early adopters can size buffers strictly via the IR path before the builders/readers are fully wired.
- [x] Emit `__tnExtractParams` + reader-side caches:
  - `from_array()` hydrates every required IR parameter by reading the sanitized primitive fields once, returns `null` when extraction fails, and threads the cache into the private constructor.
  - Instances store `this.__tnParams` and expose `dynamicParams()` so builders/validators can reuse the derived values without touching the buffer again.
- [x] Emit `static footprint(params: Type.Params): number` that:
  - converts `number` inputs to `bigint`,
  - calls `*_footprint_ir`,
  - clamps to `Number.MAX_SAFE_INTEGER`.
- [x] Update `footprint_from_values` to reuse the IR-first wrapper so flattened ABIs (like `token_program.abi.yaml`) automatically respect the shared footprint math without duplicating code.
- [x] Emit `static validate(buffer, params, opts?)` that:
  - forwards to `*_validate_ir`,
  - optionally falls back to the legacy validator only when IR metadata is missing,
  - returns `{ ok: boolean, code?: string, consumed?: number }`.
  - [x] TS `validate()` now reuses the shared IR evaluator (`__tnValidateInternal`) via the runtime walker (`__tnValidateIrTree`). It enforces buffer sizes strictly via the IR result, reports structured `tn.ir.*` codes for missing params / invalid tags / overflow, delegates nested typerefs through the registry, and returns sanitized params for reuse.
- [x] Provide convenience helpers (`footprintFromValues(accounts, payload)`) so devs don't have to hand-craft param objects in simple cases. CamelCase wrappers (`footprintIr`, `footprintIrFromParams`, `footprintFromParams`, `footprintFromValues`) are available.
- [x] Remove legacy parity code (`footprint_legacy`) from TypeScript codegen - IR is now the sole source of truth for TS.
- [x] Add unit tests covering offsets/endian handling, dynamic param caching, and parameter docs for representative ABIs (`InitializeMint`, nested unions, multi-FAM structs).
- [x] Ship a `BigInt`-fallback polyfill path (logged warning + validation guards) so the generated runtime degrades gracefully in older JS environments. `runtime_template.ts` injects lossy-but-safe DataView polyfills plus helper guards so older browsers fail gracefully instead of hard-crashing the SDK.

#### Phase 3 – Builder utilities and variant helpers
- [x] Design the fluent builder (`Type.builder()` returning a `TypeBuilder` object) with sub-builders for each tagged enum field: `.payload().select('InitializeMint').writePayload(bytes)` records the variant/tag pair, caches params, and `.build()`/`.finishView()` allocate via `footprintFromParams` while reusing the shared IR helpers.
- [x] Added the first `TypeBuilder` emission pass for constant-size, primitive-only structs so flattened ABIs can start constructing buffers without manual byte math. The builder allocates via `Type.footprint()`, exposes per-field setters, and returns either the raw `Uint8Array` or a parsed view via `finish()`. (FAM-aware setters remain TODO.)
- [x] Support `buildInto(buffer, offset = 0)` to avoid extra allocations; the method validates `buffer.length >= footprint` before writing.
- [x] On completion, builders call `Type.validate(tempBuffer, params)` so mismatches are caught before returning to the caller.
- [x] Add `Type.fromBuilder(builder)` for parity with the compliance harness (readers can clone from a builder without re-parsing bytes).
- [x] Unit-test builders with token-program examples (`TokenInstruction` payload) covering success cases and emitted reflection hooks.
- [x] Extend builder/new() emission to cover general FAM/nested structs (not just tagged enums and const layouts) and replace the `Uint8Array(0) /* TODO */` allocation path in `new_method.rs`. FAM writers now surface fluent `.field().write(bytes).finish()` helpers backed by the shared runtime cursor, and `flexibleArrayWriters` metadata advertises which struct fields expose builders.
- [x] Teach the TypeScript generator to emit builders for enums whose variants have variable-size payloads (TokenInstruction now reuses the FAM cursor/offset machinery).
  - [x] Extend `enum_field_info`/builder emission so each variant records payload offsets even when `Size::Variable`.
  - [x] Reuse the FAM cursor runtime to stream enum payload bytes after the tag, deriving counts/lengths from caller input and IR metadata.
  - [x] Ensure the generated builder writes the tag before payload bytes and passes the correct dynamic params into `validate`.
  - [x] Add TokenInstruction fixtures/tests that exercise dynamic payload variants, covering builder, validate, and `Type.fromBuilder`.
- [x] Reintroduce builders for structs whose trailing fields are variable-size type-refs. Initialize*/Transfer instruction ABIs now expose `FooInstruction.builder()` again, accept `StateProof | Uint8Array | builder` payloads for the proof tail, and their enum descriptors once more advertise nested builders via the guarded `__tnMaybeCallBuilder` hook.
- [x] Teach nested inline struct classes (e.g., `ParentWithNestedArray_nested_Inner`) to resolve parent field references inside FAM size expressions via `__tnFieldContext`/`withFieldContext` and the shared `__tnResolveFieldRef` helper; regenerate the nested-array compliance fixtures so `tsc --strict --noEmit` no longer fails on missing getters after FAMs.
- [x] Replace the `0 /* TODO */` / `return 0; /* TODO */` placeholders in TypeScript footprint/accessor code with IR-evaluated expressions so all generated APIs mirror C/Rust math.
  - [x] Audit `ts_gen/footprint.rs`, `ts_gen/helpers.rs`, and the generated fixtures (PointArray, Matrix, SDUs, etc.) to ensure the IR wrappers cover every type; the latest generator now emits only IR-backed helpers.
  - [x] Regenerated all token/counter fixtures (see `abi/abi_gen/generated/*` and `web/test-dapp/src/abi/types.ts`) so no emitted TypeScript references `TODO`.
- [x] Computed-tag builders hydrate dependent params by reading constant prefix fields (e.g., `StateProofBuilder` now parses `hdr.type_slot` from the staged prefix buffer alongside payload-derived counts), so `Params.fromValues` never receives incomplete objects and `tsc --strict` stays green once imports are wired up.
  - [x] Added `test_ts_generated_code_has_no_todo_placeholders` to `ts_codegen_tests.rs`, which regenerates the token ABI and fails immediately if any TypeScript output ever contains the substring `TODO` again.
  - [x] Support enums whose tag expressions are computed from arbitrary field expressions (e.g., `tag = (field1 + field2) & 0xFF`) for the TypeScript backend. `abi/abi_gen/src/codegen/ts_gen/builder.rs` now treats computed tags as derived parameters, `from_array()` / `__tnExtractParams()` evaluate the expression once via the sequential walker, and builders validate the derived tag before writing (see `test_ts_state_proof_computed_tag_builder`). **Follow-up:** extend the same metadata plumbing to the C and Rust emitters so all languages share the feature.
    - [x] Treat computed tags as **derived** params: tag expressions surface in `TypeIr.parameters` with a `derived: true` flag so generated `Type.Params` helpers omit them from caller-facing types and internally recompute them via `__tnPackParams`.
      - [x] Update the `TypeIr` schema + TS emitter so derived params stay private (omit from interface types, reject user-supplied values, document the behavior in `enum-fams.md`).
    - [x] Evaluate computed tag expressions inside TypeScript readers (`payloadVariant()`/`payload()`) via `__tnResolveFieldRef` so layouts like `state_proof.abi.yaml` switch variants without emitting a real tag field.
    - [x] Extend the sequential extractor/runtime cache to evaluate the expression once, memoize the derived param, and expose it through `Type.__tnDerivedParams` so `payloadVariant()` no longer recomputes the expression on every call.  
      - [x] Teach builder variant selectors to consume the cached derived tag by verifying the sequential-layout derived value after every write; computed-tag enums now build only when the derived tag matches the chosen descriptor.  
      - [x] Add regression tests (ts-codegen + StateProof harness) to prove computed-tag builders round-trip successfully once the ABI is regenerated (see `test_ts_state_proof_computed_tag_builder`).
      - [x] Fix BigInt precision for 64-bit computed tag expressions. The sequential extractor now keeps u64 field refs as BigInt (instead of converting to Number early) and uses BigInt-compatible literals (e.g., `62n`) in expressions so bitwise operations like `value >> 62n & 3n` work correctly across the full 64-bit range. See `abi/abi_gen/src/codegen/ts_gen/param_cache/extractor.rs` (`emit_field_ref_prelude`, `expr_to_ts_bigint_with_resolver`) and `helpers.rs` (`literal_to_bigint_string`). This fixes `state_proof.abi.yaml` parsing which uses `(hdr.type_slot >> 62) & 3` to derive the variant tag.
- [x] Generate actual reader surfaces for tagged enums/unions. `TokenInstruction_payload_Inner` now exposes IR-driven `payloadVariant()`/`payload().asFoo()` helpers; StateProof can ride the same path next.
  - [x] Emit per-variant wrapper classes (or discriminated unions) that expose strongly typed payload getters and reuse the zero-copy buffer.
  - [x] Generate `payloadVariant()` plus convenience helpers (`payload().asInitializeMint()`, etc.) on the parent struct that switch on the IR tag and return the appropriate wrapper.
  - [x] Ensure the runtime slices each variant payload using IR offsets/footprints so readers don’t alias the remainder of the buffer.
  - [x] Update `ts_codegen_tests.rs` (and, if needed, add a dedicated fixture) to assert that the generated code exposes these helpers for TokenInstruction and StateProof.
- [x] Fix `TokenInstructionBuilder.__tnWriteInto` so payload bytes start after the tag. Builders now honour each field’s `ResolvedField::offset`.
- [x] Harden enum builders beyond the TokenInstruction fixtures. Single-enum structs now store per-field payload buffers (`__tnPayload_<field>`) just like multi-enum builders, compute `max(requiredSize, footprintSize)` using the IR payload offset, and write payload bytes after the tag. The TS harness hydrates builders with the corrected metadata offsets, so `enums/{value,bytes,pair}.yaml` decode→reencode→compare succeeds.
- [x] Support structs containing multiple tagged enum fields. `enum_field_infos()` now surfaces every `(tag, payload)` pair, the builder emits per-enum setters/selectors, and the new sequential param extractor walks variable-length prefixes so later tag fields (e.g. `InterleavedEnum::tag2`) derive automatically. `cargo test --manifest-path abi/abi_gen/Cargo.toml --test ts_codegen_tests` and `cargo run --manifest-path abi/abi_gen/tests/compliance_harness_rust/Cargo.toml -- abi/abi_gen/tests/compliance_tests/test_cases/interleaved_enums --language ts` both pass with the new builder.
- [x] Re-emit getters/setters for fields that appear after a variable-sized member (FAM or enum payload). `emit_struct_class` now calls the sequential layout helper whenever a field lacks a static offset, so `TokenInstruction.payload()` and every post-FAM field regain their accessors (see `abi/abi_gen/src/codegen/ts_gen/types.rs` + `param_cache/extractor.rs`). Decode→builder regression tests (e.g. `array_structs/dual_arrays`) confirm the offsets stay in sync with the runtime cursor.
  - [x] **Design/runtime helper:** Extract the sequential cursor from the TypeScript param extractor into a reusable helper that can compute per-field offsets (mirroring the IR math for primitives, enums, SDUs, nested structs/FAMs). Document the helper and add unit coverage so we know it produces stable offsets.
  - [x] **Wire getters/setters:** Update `emit_struct_class` to call the helper whenever `ResolvedField::offset` is `None`, so every field regains `get_*`/`set_*` APIs even after flexible sections. Add a ts-codegen fixture (e.g., `array_structs/dual_arrays.yaml`) plus assertions in `ts_codegen_tests.rs` to prove the getters exist and point at the expected byte ranges.
- [x] Slice nested `type-ref` fields with explicit bounds. `emit_struct_class` now passes `subarray(offset, offset + sizeof(field))` for every typeref so zero-copy reads stay safe.
- [x] Extend the TS dynamic-parameter extractor beyond structs. `param_cache::resolve_segments` now walks enum variants/union cases so future layouts can derive params automatically.
- [x] Derive payload sizes for size-discriminated unions. Struct resolution now records `field.payload_size` as a dynamic parameter whenever a size-discriminated union appears, and the TS param extractor treats those entries as sequential bindings so `MessageWithSDU.__tnExtractParams` can compute the payload length from the remaining bytes. `test_ts_size_discriminated_union_params` confirms `MessageWithSDU.from_array` derives `dynamicParams()` without caller input and runs a Node script that prints `sdu ok`.
- [x] Do the same for tail-position tagged enums. Struct resolution now injects a synthetic `field.payload_size` parameter whenever a tail enum contains any variable-length variant, drops the variant-scoped field refs, and lets the sequential extractor derive the size from the remaining bytes. Builders feed the new param via the selected payload’s byte length, and the harness hydrates `payloadSize: null` descriptors by slicing the rest of the buffer. See `test_ts_tail_enum_payload_params` plus the new `compliance/tail_enum` fixture for coverage, and note that enums can now reuse flexible payload definitions through `type-ref` aliases instead of inlining one-off structs.
- [x] Teach the TypeScript compliance harness to accept enum metadata with `payload_size = null`. When a variant’s payload length is dynamic, the harness now skips builder hydration for that entry instead of assuming a constant slice, which keeps the decode→builder→fromBuilder loop stable once we introduce variable-length enum payloads.
- [x] Keep deriving offsets for size/count fields even after the first flexible array. `__tnExtractParams` now walks variable-length arrays by evaluating their size expressions against previously cached field values, advances the cursor, and keeps scanning for later primitives (e.g., the second length/count in `array_structs/dual_arrays.yaml`). See `abi/abi_gen/src/codegen/ts_gen/param_cache/extractor.rs` for the sequential walker updates.
- [x] Generate TypeScript for nested-array fixtures (`nested_array_structs/*.yaml`, `deeply_nested_array_structs/*.yaml`). The param extractor now resolves parent-linked size expressions, the generator emits `withFieldContext`/`__tnResolveFieldRef` helpers, the ts-codegen suite gained a regression test, and the TypeScript compliance harness seeds derived field contexts so strict `tsc` plus decode/roundtrip succeed for both nested fixtures.
- [ ] Run `tsc --strict --noEmit` against the compliance fixtures and fix the outstanding issues called out by the compiler:
  - [x] Guard every console/global usage through the runtime shim so `tsc --lib ES2020` succeeds without DOM (tests now fail if generated files reference `console.*` outside the shim).
  - [x] Route all parameter writes through `Params.fromValues`/`fromBuilder` (no direct `.field = value` on readonly types).
  - [x] Delete the last legacy `switch(tag)` stubs (replace with real descriptors or remove the branch) so the compiler sees real tag variables. The generator no longer emits literal `switch (tag)` blocks (verified by ts-codegen tests), and the regression suite now asserts that `thru/program/token/types.ts` never contains the legacy snippet.
  - [x] Only reference nested builders that actually exist (fallback to `() => null` when a nested struct lacks `builder()`). Variant descriptors now call the runtime-level `__tnMaybeCallBuilder()` helper, which wraps every `Foo.builder()` lookup in a `typeof === "function"` check, so TypeScript no longer references missing static builders.
  - [x] Stop calling private helpers (`__tnFootprintInternal`, `__tnValidateInternal`) from outside the class; expose public wrappers and update harness glue accordingly (ts-codegen tests now fail if anything other than `this.__tn*` appears).
  - [x] Run the vendored `tsc --strict --noEmit --target ES2020 --lib ES2020` for every compliance package (harness + `ts_codegen_tests`) so regressions gate CI. The TypeScript harness now runs a strict, no-emit compile for both the generated source tree and the per-test project `tsconfig` before executing Node, and the regression tests still invoke the same vendored `tsc --strict --noEmit` guard.
- [ ] Guarantee that every compliance ABI actually emits TypeScript sources. `nested_array_structs/*.yaml` and `deeply_nested_array_structs/*.yaml` still fail at the harness compilation stage because `ts_gen` never produces `types.ts` for those packages (`TS2307: Cannot find module './generated/.../types.js'`). **Note:** this is lower priority for the token-program milestone because all of our near-term ABIs can wrap payloads in a struct; we can defer non-struct top-level support until after the token builders are stable.
- [x] Support array element references (`field_ref.path = ["array_field", "0"]`) inside size/tag expressions. Updated `resolve_field_read` in `param_cache/extractor.rs` to handle `ResolvedTypeKind::Array` by parsing numeric path segments as indices, computing element offsets (index × element_size), and continuing resolution into the element type. Also:
  - Extended `type_lookup` in TypeScript codegen to include all resolved types (not just the current package) so cross-package TypeRef resolution works (e.g., `Hash` from `thru.common.primitives`).
  - Added `collect_enum_variant_fam_refs` helper to collect field refs from variant FAM size expressions.
  - Auto-populate `__tnFieldContext` in parent struct accessors with array element values needed by inner variant classes. The `proof_body()` accessor in `StateProof` now reads `hdr.path_bitset.bytes[0..3]` and passes them to the wrapper via auto-generated `__tnAutoContext`.
  - StateProof now works without manual `withFieldContext()` calls - the FAM size expression (`popcount(bytes[0]) + popcount(bytes[1]) + ...`) evaluates correctly using auto-populated context values.
  - Updated `abi_reflect` parser to support array element references and popcount expressions: added `Popcount` handling to `evaluate_tag_expression`, root buffer/type tracking for nested TypeRef contexts, and fallback field resolution for FAM size expressions referencing parent struct fields. Added 4 parser tests covering all StateProof variants and multi-byte popcount sums.
  - Created `token_program_full.abi.yaml` with all dependencies inlined (Hash, Pubkey, StateProof) for WASM reflection tests.
  - Added WASM bridge tests for StateProof reflection covering computed tags and popcount-based FAM sizes.
- [ ] Allow computed enum tag expressions (e.g., `(field1 + field2) & 0xFF`) instead of requiring a plain `field_ref`.
  - [ ] **Resolver (TS-focused pass)**: teach `resolve_field_type_from_path` + constant-status analysis to accept numeric path segments (const array elements) and surface them in `dynamic_params`, flagging computed tags as `derived` so downstream `Type.Params` code knows they should be auto-calculated.
  - [ ] **IR builder (TS)**: when an enum tag uses an arbitrary `ExprKind`, emit a synthetic derived parameter (e.g., `_enum_tag_<field>`) that lowers the expression via `build_expr_ir` so `SwitchNode.tag` has a canonical name even if no raw field stores the tag.
  - [ ] **Param extraction/runtime (TS)**: compute those synthetic tag params at decode time—extend the sequential layout helper to evaluate the expression (using the same AST) and stash the tag in `__tnSeqParams`, plus add a `Params.fromValues` helper that recomputes it automatically for builders while keeping the field off the public `Type.Params` surface.
  - [ ] **Emitters/tests (TS + state_proof target)**: update `footprint()`, `validate()`, and builder variant selectors to rely on the derived tag param instead of a raw field, regenerate both the `computed_enums` fixture and `abi/type-library/state_proof.abi.yaml`, and add harness coverage (`tsc --strict --noEmit` + decode→builder roundtrips) so regressions are caught automatically.
  - [ ] **Docs**: add a “Computed enum tags & derived params” section to `enum-fams.md` (and reference `state_proof.abi.yaml`) so ABI authors know how to write these expressions and what the TypeScript surface looks like.

#### Phase 4 – Harness + documentation
- [ ] Update `abi/enum-fams.md` (done) and the SDK README with the new API sketch (Token Program example) so downstream teams know how to migrate.
- [x] Update `abi/abi_gen/tests/compliance_harness_rust/src/language_runner/typescript.rs` to:
  - use `Type.builder()` instead of manual byte copies,
  - fetch dynamic params via `view.dynamicParams()` when validating,
  - assume the IR helpers are the default path (no feature flags) and fail loudly when metadata is missing,
  - run `tsc --strict --noEmit` inside the harness so compiler diagnostics gate codegen regressions.
- Harness status: the rewritten runner now drops a per-project `tsconfig.json`, pre-transpiles generated sources, coerces `dynamicParams()` through the emitted `Type.Params` helpers, and falls back to byte copies when `builder()/fromBuilder()` are absent. `cargo run … --language ts` (2025-11-25) reports **31/31** passing cases with IR-first codegen; the full log lives under `/tmp/harness_logs/compliance_ts.log`.
- [x] Run `abi/scripts/run_ir_parity_checks.py --skip-previews --run-harness` so the parity helper executes C, Rust, and TypeScript harnesses in one shot (TypeScript is now part of the default language list). Logs for all three languages land under `/tmp/harness_logs/compliance_*.log`.
- [ ] Update `web/packages/thru-sdk/thru-ts-client-sdk/modules/__tests__/abi.test.ts` to cover the new builder/reader ergonomics (enum tag switching, SDU payload selection, zero-length FAMs, BigInt fallback warnings, validation failures).


### 5. Validation & Compliance

1. Extend compliance suite (`abi/abi_gen/tests/compliance_*`) with:
   - Enums containing FAM variants.
   - Structs with nested enums after FAMs.
   - Unions without embedded tags (caller-supplied variant).
2. Add property-based fuzzing:
   - Rust: derive `proptest::Arbitrary` via generated code.
   - TypeScript: generate `fast-check` arbitraries and round-trip tests.
3. Integrate overflow and zero-length regression tests.
4. **Blocking criteria**: All updated generators must keep every test in `abi/abi_gen/tests/compliance_harness_rust` and `abi/abi_gen/tests/compliance_tests` passing in CI; implementation is not complete until both suites are green.
   - [ ] Author new ABI YAMLs covering edge cases and add them to `tests/compliance_tests/abi_definitions`.
   - [ ] Regenerate binary fixtures via `generate_test_data.py`; check in results.
   - [ ] Update Rust harness to include new cases; ensure CI job `cargo test -p compliance_harness_rust` runs automatically.
   - [x] Add TypeScript harness automation (builders, dynamic params, IR toggles, `tsc --strict`) to CI and `abi/scripts/run_ir_parity_checks.py` so IR parity spans all three languages.
   - [ ] Add proptest + fast-check suites; wire them into nightly workflows and document reproduction steps.
   - [x] 2025-11-21: Captured fresh CLI previews for every compliance ABI via `python3 abi/scripts/run_ir_parity_checks.py`; latest logs live under `/private/tmp/footprint_logs/` and `/private/tmp/validate_logs/` for auditability.

---

### 6. Tooling & DX

1. CLI enhancements (`abi/abi_gen/src/cmds`):
   - [x] Add `--print-ir` flag that serializes the new IR to stdout with pretty formatting.  
     - `abi analyze --print-ir` now uses `IrBuilder` + `serde_json::to_string_pretty` to dump `LayoutIr`. It currently emits `Const`-only IR (variable types return informative errors) until the IR generator is fully wired.
   - [ ] Implement `abi validate <file>` that runs resolver + new validation rules, returning exit code 1 on failure.
   - [ ] Write integration tests invoking the CLI via `assert_cmd`.
2. Documentation:
   - [ ] Update `ABI_SPECIFICATION.md` sections on enums/FAMs to reference new tooling.
   - [ ] Add “Enum FAM Cookbook” with examples in `docs/`.
   - [ ] Link `enum-fams.md` and `enums-fam-impl.md` from repo README/developer guide for discoverability.

---

### 7. Milestones

1. **M1 – Resolver + IR scaffolding** ✅
   - [x] Complete tasks in Sections 1–2.
   - [x] Demo: `abi analyze --print-ir StateProof` outputs human-readable IR.
   - [x] Exit criteria: Resolver/IR tests green, docs updated.

2. **M2 – TypeScript as reference implementation** ✅
   - [x] TypeScript codegen is fully IR-first (legacy removed).
   - [x] 31/31 compliance tests passing.
   - [x] Computed enum tags, popcount FAMs, array element references all working.
   - [x] Exit criteria: TS is the canonical reference for C/Rust migration.

3. **M3 – C/Rust codegen migration** (in progress)
   - [ ] Add cross-language parity tests: compare C/Rust output against TypeScript.
   - [ ] Port C/Rust to IR-only, validating against TS (not legacy).
   - [ ] Delete legacy code category-by-category once TS parity confirmed.
   - [ ] Demo: C/Rust decode/validate/re-encode matches TS byte-for-byte.
   - [ ] Exit criteria: Legacy code removed from C/Rust, all harnesses green.

4. **M4 – Validation hardening**
   - [ ] Finalize compliance additions, fuzzers, documentation + migration guides.
   - [ ] Demo: CI run showing compliance + prop tests green across all languages.
   - [ ] Exit criteria: All blocking tests configured and passing by default.

---

### 8. Success Criteria

- [x] TypeScript IR codegen is the reference implementation (legacy removed, 31/31 compliance tests).
- [x] `token_program.abi.yaml` and enum+FAM fixtures compile into working TS bindings.
- [x] Reflection can parse tagged enums with variable-size variants (StateProof with computed tags + popcount FAMs).
- [ ] C/Rust bindings match TypeScript output byte-for-byte for all compliance tests.
- [ ] Legacy code removed from C/Rust backends.
- [ ] Cross-language round-trip tests: build in language A, decode in language B.
- [ ] Before closing the epic, regenerate bindings for at least one consumer in each language and confirm no manual edits were required.

Delivering these workstreams satisfies the contract defined in `enum-fams.md` and unlocks cross-language support for complex enum layouts.
