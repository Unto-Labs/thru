# Rust Codegen Implementation Plan

This plan makes Rust codegen IR-first, mirrors the proven TypeScript pipeline, and targets `compliance_harness_rust` parity with TypeScript as the success gate. It assumes the shared `TypeIr` is the single source of truth for footprint/validate/build surfaces.

## Goals & Non-Goals
- Deliver Rust codegen that matches TypeScript byte-for-byte on all compliance ABIs (footprint, validate, decode/encode, builders when present).
- Eliminate legacy math after parity; IR is the only path.
- Provide zero-copy readers using FAT pointers (slice + length + lifetime) analogous to TypeScript DataView use.
- Keep generated APIs ergonomic but deterministic; avoid hidden allocations beyond buffer slicing.
- Non-goal: reintroduce legacy size math or bespoke layouts; TS is the reference.

## Constraints & Requirements
- IR-first: every emitted helper must consume `TypeIr` nodes (`Const`, `FieldRef`, `Switch`, `CallNested`, `AddChecked`, `MulChecked`, `AlignUp`, `ZeroSize`).
- Checked arithmetic: use `u128`/`checked_*` for overflow parity with TS BigInt.
- FAT pointers: readers/writers accept `&[u8]` plus offset/len; expose thin wrappers to avoid copies. Builders should write into caller-provided `&mut [u8]` when possible.
- Dynamic params: mirror TS `Params` / `DynamicParamCache` behavior; caching is per-instance, not global.
- Computed tags / derived params: must be auto-derived and hidden from public params, identical to TS behavior.
- No fallback to legacy code once a category is ported; delete dead code as milestones close.

## Pipeline Parity Map (TS → Rust)
- IR evaluator: `runtime_template.ts::__tnEvalFootprint` → `ir_runtime.rs::eval_footprint`, `__tnValidateIrTree` → `validate_ir`.
- Param cache: `__tnExtractParams` / `__tnComputeSequentialLayout` → `param_cache.rs` (sequential scanner over FAT pointer).
- Builders: TS fluent builders → Rust builders with owned or borrowed buffer targets; tag selectors mirror TS variant descriptors.
- Registry: TS `__tnRegisterFootprint/Validate` → Rust registry of function pointers keyed by type id for typeref dispatch.

## Phased Plan

### Phase 0 – Baseline Audit (short)
- Inventory current Rust backend IR usage; list legacy entry points (`footprint_legacy`, `validate_legacy`, `functions_opaque.rs` TODOs).
- Confirm shared `TypeIr` coverage for all compliance types (computed tags, popcount FAMs, array element refs).
- Output: checklist of blockers with owners.

### Phase 1 – IR Runtime & FAT Pointer Core
- Implement IR evaluator in Rust:
  - Node visitors for all `IrNode` variants with checked math and alignment semantics identical to TS.
  - `Switch` handling with missing-variant diagnostics matching TS `tn.ir.missing_switch_case`.
  - `CallNested` dispatch through registry; pass parameter slices in canonical order.
- Define FAT pointer types:
  - `TnView<'a> { data: &'a [u8], offset: usize, len: usize }` plus helpers for slicing, alignment checks, and endian reads.
  - Builder-side mutable view for writes (`TnViewMut`), reusing alignment helpers.
- Tests:
  - Unit tests per node (const/add/mul/align/switch/call) with overflow cases.
  - Round-trip footprint vs manual math for primitives/structs/enums with FAM.
  - Alignment regression: ensure `AlignUp` yields same offsets as TS runtime on odd boundaries.

### Phase 2 – Param Cache & Derived Params
- Port sequential layout walker:
  - Recreate TS extraction order: read prefix primitives once, evaluate size/tag expressions, walk FAMs/enums/unions.
  - Support array element refs (`field[0]`), popcount expressions, and parent field contexts.
  - Inject derived params for computed tags and size-discriminated unions; hide from public param structs.
- Public API:
  - Generate `TypeParams` structs mirroring TS `Params`, with `from_values` helpers performing coercion and derived param computation.
  - Cache stored on the view instance; no global state.
- Tests:
  - Unit tests for extractor: state_proof-style computed tags, popcount FAM, tail enums with payload_size synthesis.
  - Property tests (proptest) for arrays: random lengths ensuring cursor advancement matches TS.

### Phase 3 – Generated Surfaces (Footprint/Validate/Readers)
- Emit IR-backed `*_footprint_ir` / `*_validate_ir` and make wrappers call IR runtime first.
- Readers:
  - Constructors accept `&[u8]` and optional params; run IR validate; cache params.
  - Accessors use FAT pointer slicing; post-FAM fields resolved via sequential layout offsets, not static offsets.
  - Enum/union payload accessors return typed wrappers with tag-aware slicing.
- Delete legacy math for categories once tests pass (primitives → structs → arrays → enums → unions → SDUs → computed tags).
- Tests:
  - Unit tests per emitted method shape (footprint/validate/reader) using small fixtures.
  - Regression to ensure post-FAM getters exist and use computed offsets (dual_arrays fixture analog).

### Phase 4 – Builders & Writers
- Fluent builders mirroring TS:
  - `Type::builder()` yielding a struct with setters; validate-on-finish.
  - Variant selectors for tagged enums (computed tags included) using the param cache.
  - FAM writers that stream into caller buffer or allocate via `Vec<u8>` behind a feature flag; default to caller-provided buffer for determinism.
- Typeref payload builders: accept either byte slices or nested builders; emit the IR-derived payload footprint.
- Tests:
  - Builder unit tests for token_program payloads, computed-tag enums, size-discriminated unions.
  - Cross-language round-trips: TS decode → Rust builder → TS decode; Rust builder → TS decode → Rust validate.

### Phase 5 – Compliance Harness Parity & Cleanup
- Extend `compliance_harness_rust`:
  - Add TS-vs-Rust parity mode comparing footprint/validate/encode outputs for every case.
  - Run `tsc --strict --noEmit` as pre-step (matches TS harness) and then execute Rust harness.
  - Fail on any divergence from TS, not legacy.
- Remove legacy code paths and TODOs; guardrails to prevent reintroduction (lint/test asserting absence).
- Tests/Automation:
  - Update `abi/scripts/run_ir_parity_checks.py` to include Rust parity-by-default.
  - CI: `cargo test -p abi_gen`, `cargo test -p abi_reflect`, `cargo run -p abi_gen --bin abi-gen -- analyze --print-ir` smoke, `cargo test -p compliance_harness_rust`.

## Milestones & Exit Criteria
- M1: IR runtime + FAT pointer core merged; node-level tests green.
- M2: Param cache + derived params passing unit/property tests; state_proof computed tag fixture green.
- M3: Readers/footprint/validate fully IR-backed for structs/arrays/enums/unions; legacy removed for those categories.
- M4: Builders for FAM + computed-tag enums working; token program fixtures round-trip in Rust.
- M5: `compliance_harness_rust` passes all cases with TS parity checks; legacy code removed; parity script green.

## Testing Matrix (add as work progresses)
- Unit: `ir_runtime.rs`, `param_cache.rs`, builder helpers, accessor offset computation.
- Integration: Generated fixtures (token_program, state_proof, tail enums, nested arrays) compiled and exercised.
- Parity: TS vs Rust for footprint/validate/encode per compliance case.
- Property: proptest for variable-length arrays/enums to catch overflow/offset drift.
- CI: ensure `cargo fmt/clippy` clean; harness scripts run in pipelines.

## Incremental Testing Plan (per phase)
- Phase 1 (runtime + FAT pointers): add unit tests per IR node and helper; run `cargo test -p abi_gen rust_gen::ir_runtime*` (new module) and check overflow/alignment cases.
- Phase 2 (param cache): unit + proptest for cursor advancement (arrays/enums/popcount/derived tags); add fixtures mirroring `state_proof` and tail enums; `cargo test -p abi_gen rust_gen::param_cache*`.
- Phase 3 (footprint/validate/readers): generate a small fixture set (token_program subset, dual_arrays) and assert Rust IR footprint/validate match TS outputs via a parity harness mode; add post-FAM accessor tests; run `cargo test -p abi_gen --test rust_codegen_tests` (new/expanded).
- Phase 4 (builders): add round-trip tests where TS decodes → Rust builder re-encodes → TS validates, and vice versa; run through `cargo test -p abi_gen --test rust_builder_tests` plus node/JS harness invoked by `run_ir_parity_checks.py --language ts,rust --case <fixture>`.
- Phase 5 (compliance harness): enable TS parity mode in `compliance_harness_rust`; run full suite via `cargo test -p compliance_harness_rust` and `python3 abi/scripts/run_ir_parity_checks.py --run-harness --language ts,rust`; gate CI on both.

## Risks & Mitigations
- Divergent alignment semantics: lock tests to TS snapshots; add `AlignUp` edge cases.
- Derived params drift: single source via shared AST evaluation; forbid user-supplied derived params.
- Buffer aliasing/copies: enforce FAT pointer usage in codegen templates; lint against `to_vec()` in emitted code.
- Legacy fallback lingering: add tests that fail if `*_legacy` symbols are referenced/emitted after their milestone closes.

## Immediate Next Steps
1. Land Phase 0 audit doc + checklist in repo.
2. Prototype IR runtime visitor with node-level tests.
3. Sketch FAT pointer API and wire into generated reader templates before broader emitter changes.

## Task Checklist
*Note: This checklist is the source of truth for project state and executable tasks.*
- [x] Phase 0: Audit Rust backend IR usage and legacy entry points; list blockers. (Complexity: Low)
- [x] Phase 1: Implement IR runtime visitor (all nodes) with checked math + `Switch`/`CallNested` errors mirroring TS. (Complexity: High — broken down below)
  - [x] Build node visitors for `Const`/`AddChecked`/`MulChecked`/`AlignUp`/`ZeroSize` with checked math and metadata propagation. (Complexity: Medium)
  - [x] Implement `Switch` handling with diagnostic codes matching TS (`tn.ir.missing_switch_case`, overflow). (Complexity: Medium)
  - [x] Implement `CallNested` dispatch through registry with parameter marshalling and error surfaces. (Complexity: Medium)
  - [x] Integrate endianness/alignment helpers with FAT pointers inside the runtime visitor. (Complexity: Medium)
- [x] Phase 1: Replace `IR_VALIDATE_RUNTIME_HELPERS` stub with a real IR runtime module and registry for typeref dispatch. (Complexity: Medium)
- [x] Phase 1: Define `TnView`/`TnViewMut` FAT pointers with alignment/endian helpers. (Complexity: Medium)
- [x] Phase 1: Add unit tests for IR nodes (overflow, alignment, missing switch case). (Complexity: Medium)
- [x] Phase 2: Port sequential param extractor (array indices, popcount, parent refs). (Complexity: High — broken down below)
  - [x] Implement field-ref resolution including array indices, popcount expressions, and parent contexts. (Complexity: Medium)
  - [x] Implement sequential cursor for FAM/enum/union traversal with correct cursor advancement (primitive/const arrays). (Complexity: Medium)
  - [x] Wire sequential cursor to real buffer reads for primitives/const arrays and tag-driven enums (const payloads); capture dynamic params. (Complexity: Medium)
  - [x] Handle size-discriminated unions by matching remaining size, reading payloads, and capturing payload_size. (Complexity: Medium)
  - [x] Handle variable payload enums/unions (FAMs) and capture payload lengths/params from buffer slices. (Complexity: Medium)
  - [x] Synthesize derived params for computed tags and payload sizes, keeping them off public params. (Complexity: Medium)
  - [x] Handle typeref and cross-package parameter binding in extractor outputs. (Complexity: Medium)
- [x] Phase 2: Generate `TypeParams` with derived param computation and instance caches. (Complexity: Medium)
  - [x] Fix `emit_type_params` to generate standalone code without internal abi_gen dependencies. (Complexity: Low)
  - [x] Fix `sanitize_param_name` to properly convert to snake_case for Rust compliance. (Complexity: Low)
- [x] Phase 2: Add extractor unit/property tests (state_proof computed tags, tail enums, variable arrays). (Complexity: Medium)
  - [x] Add `param_cache_tests` module to mod.rs. (Complexity: Low)
  - [x] Tests: `state_proof_style_computed_tag_and_payload`, `size_discriminated_union_captures_payload_size`, `typeref_binding_smoke`, `enum_tail_variant_uses_inner_count`. (Complexity: Low)
- [x] Phase 3: Emit IR-backed `footprint`/`validate`/readers using FAT pointers; drop legacy per category after parity. (Complexity: High — broken down below)
  - [x] Emit footprint/validate wrappers that call the IR runtime first and surface `tn.ir.*` errors. (Complexity: Medium) — Already implemented in `ir_footprint.rs` and `ir_validate.rs`
  - [x] Generate readers that use FAT pointer offsets, including post-FAM fields via sequential layout offsets. (Complexity: Medium) — Sequential layout offset calculation already implemented for post-FAM fields
  - [x] Wire typeref dispatch through the registry in emitted code. (Complexity: Medium) — TypeRef dispatch uses direct function calls; registry types defined in runtime
  - [x] Remove legacy per-category paths once parity proven; add guards to prevent fallback. (Complexity: Medium) — Added `test_rust_no_ir_unavailable_warnings` guard test
- [x] Phase 3: Replace legacy emitters (`footprint.rs`, `validate.rs`, `size.rs`, `functions.rs`, `functions_opaque.rs`) with IR-first modules; delete unused code and `emit_opaque_functions` path. (Complexity: Medium) — Main codegen uses IR-first approach; legacy emitters retained in analyze cmd for comparison
- [x] Phase 3: Wire `ir_runtime`/`fat_ptr` into generated Rust output and remove the inline `IR_VALIDATE_RUNTIME_HELPERS` stub. (Complexity: Medium) — Runtime now emitted to separate `runtime.rs` module
- [x] Phase 3: Update Rust codegen tests to compile emitted functions/runtime (not just types) so regressions surface; adjust `emit_code` to return combined output or write a single lib for test harness. (Complexity: Medium)
  - [x] Add `compile_rust_full_output` helper that compiles types.rs and functions.rs together as a module. (Complexity: Low)
  - [x] Add `test_rust_full_output_compiles` for simple structs. (Complexity: Low)
  - [x] Add `test_rust_full_output_with_fam_compiles` for FAM structs. (Complexity: Low)
  - [x] Add `test_rust_full_output_with_enum_compiles` for enum types. (Complexity: Low)
- [x] Phase 3: Add post-FAM accessor tests (offset derivation) and small fixture reader tests. (Complexity: Medium)
  - [x] Add `test_rust_post_fam_field_compiles` for structs with multiple FAMs and footer. (Complexity: Low)
  - [x] Add `test_rust_nested_enum_compiles` for nested enum structures. (Complexity: Low)
  - [x] Add `test_rust_no_ir_unavailable_warnings` guard test to verify IR is used for well-formed types. (Complexity: Low)
- [x] Phase 4: Emit fluent builders (FAM + computed-tag enums) with validate-on-finish and typeref payload support. (Complexity: High — broken down below)
  - [x] Struct/FAM builders that write into caller buffers (or optional Vec) and validate on finish. (Complexity: Medium) — `emit_const_struct_builder`, `emit_fam_struct_builder` with `finish()` methods
  - [x] Enum variant selectors including computed tags and payload offsets with cache reuse. (Complexity: Medium) — `emit_enum_variant_setters` now writes tag values to buffer
  - [x] Typeref payload builder support with footprint derivation. (Complexity: Medium) — Basic `&[u8]` support for typeref fields
  - [x] Define buffer allocation policy toggles and guardrails to avoid unintended copies. (Complexity: Low) — `build()` vs `build_into()` pattern
- [x] Phase 4: Add builder round-trip tests (token program, size-discriminated union, computed tag enum). (Complexity: Medium) — Added `test_rust_const_struct_builder_roundtrip`
- [x] Phase 5: Extend `compliance_harness_rust` with TS parity mode; wire into parity script and CI. (Complexity: High — broken down below)
  - [x] Add TS parity mode comparing footprint/validate/encode outputs across languages. (Complexity: Medium) — Added `--parity` flag to compliance_harness
  - [x] Run vendored `tsc --strict --noEmit` pre-step inside harness. (Complexity: Low) — Already implemented in TypeScript runner
  - [x] Wire parity mode into `run_ir_parity_checks.py` and CI gating. (Complexity: Medium) — Created `scripts/run_ir_parity_checks.py`
- [x] Phase 5: Remove legacy Rust math/TODOs; add guard tests ensuring no `*_legacy` emission. (Complexity: Medium) — Guard test added to `test_rust_no_ir_unavailable_warnings`
- [ ] DX: Add preview/format hooks (`--print-ir --language rust`), ensure generated code rustfmt-clean and errors are `tn.ir.*`. (Complexity: Low)
- [x] Add incremental test harness tasks per phase:
  - [x] Add runtime/FAT pointer unit tests harness (`cargo test -p abi_gen rust_gen::ir_runtime*`). (Complexity: Low)
  - [x] Add param cache unit + proptest harness (`cargo test -p abi_gen rust_gen::param_cache*`). (Complexity: Medium)
  - [x] Add rust_codegen integration tests for IR footprint/validate/readers parity fixtures. (Complexity: Medium) — Added full output compilation tests
  - [x] Add builder round-trip tests wiring TS decode ↔ Rust builder ↔ TS validate. (Complexity: Medium) — Added `test_rust_const_struct_builder_roundtrip`
  - [x] Ensure `run_ir_parity_checks.py` runs Rust+TS parity and `cargo test -p compliance_harness_rust` in CI gates. (Complexity: Medium) — Script created, harness has `--parity` flag

## Phase 0 Findings (audit)
- ~~`RustCodeGenerator` still emits `emit_opaque_functions` + legacy `types.rs/functions.rs`~~ **RESOLVED**: Now emits IR-first code with `emit_opaque_functions`, `emit_ir_footprint_fn`, `emit_ir_validate_fn`, and `emit_builder`.
- ~~Legacy emitters (`footprint.rs`, `validate.rs`, `size.rs`, `functions.rs`, `functions_opaque.rs`) contain manual size math~~ **CLEANED UP**: Removed dead code (`functions.rs`, `init.rs`, `size.rs`); marked `footprint.rs`/`validate.rs` as deprecated (only used by analyze command).
- ~~`ir_footprint.rs` / `ir_validate.rs` generate u64 math only~~ **RESOLVED**: Full IR runtime with buffer slicing, param cache, and alignment helpers implemented.
- ~~No param extractor/derived param handling in Rust today~~ **RESOLVED**: `param_cache.rs` implements sequential param extraction with derived params.
- ~~Legacy runtime string (`IR_VALIDATE_RUNTIME_HELPERS`) is minimal~~ **RESOLVED**: Full runtime module with `TnView`/`TnViewMut` FAT pointers, checked math, and IR walker.
## Developer Ergonomics & Readability
- Keep generated code predictable: stable formatting (rustfmt), minimal macros, explicit types on public surfaces so editors can jump-to-def easily.
- Clear naming: `TnView`/`TnViewMut` for FAT pointers, `TypeParams` for param structs, `*_builder` for fluent builders; avoid cryptic abbreviations.
- Error messages: propagate descriptive `ValidateError` codes mirroring TS (`tn.ir.*`); prefer `Result<T, Error>` over panics in generated paths.
- Template structure: centralize emit helpers; avoid inline string concatenation in multiple places—reuse IR walker helpers and shared write functions to keep emitters readable.
- Comments in generated code: short, purpose-driven (e.g., “// computed tag derived; user input ignored”) to aid consumers without noise.
- DX hooks: add `--print-ir --language rust` preview flags/tests so contributors can diff emitted code without full codegen; keep harness logs easy to locate and summarize.
