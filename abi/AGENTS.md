# Repository Guidelines

## Project Structure & Module Organization
`abi_gen/` is the Rust workspace for schema resolution, Layout IR construction, and the C/Rust/TS generators (see `enum-fams.md` + `enums-fam-impl.md` for the active contract). `abi_reflect/` carries the reflection CLI/runtime, while ABI inputs sit in `type-library/*.abi.yaml` plus `token_program.abi.yaml`; supporting notes in `Cross-Language FAM Enum Code Generation.md`, `implementation-tracking.md`, and `summary.md` capture outstanding FAM decisions. For a current architectural walkthrough, always consult `abi/abi_gen/docs/pipeline-overview.md`.

## Build, Test, and Development Commands
Run `cargo test -p abi_gen` after any resolver, IR, or backend change; `cargo test -p abi_reflect` guards reflection outputs. Use `cargo run -p abi_gen --bin abi-gen -- analyze --print-ir` for a quick sanity check on Layout IR, then add `--print-footprint <Type>` or `--print-validate <Type>` to inspect IR helpers (C/Rust still show legacy math for parity comparison). TypeScript fixtures rely on the vendored harness in `abi_gen/tests/ts_toolchain` (`npm test`). Use `python3 abi/scripts/run_ir_parity_checks.py --skip-previews --run-harness` (plus `--language`/`--case` as needed) for end-to-end parity across previews and harnesses.

## Coding Style & Naming Conventions
Rust crates follow `cargo fmt`/`clippy`; match on IR enums exhaustively so new nodes fail loudly. Resolver math must flow through `LayoutGraph` and the canonical dynamic-parameter map; never reinvent size arithmetic per backend. Generated C APIs sanitize identifiers via `escape_c_keyword` and route footprint/validate through the IR helpers (legacy math remains only as a parity fallback for C/Rust). TypeScript is fully IR-first (legacy removed) and uses the runtime in `ts_gen/runtime_template.ts` plus DataView + `bigint` for 64-bit values and cached dynamic parameters. Keep builders/validators deterministic and cache parameters per instance instead of globals; defer to `abi/abi_gen/docs` for the latest backend-specific norms.

## Testing Guidelines
Keep regression tests beside the code you modify (`abi_gen/src/abi/*_tests.rs`, `abi_gen/tests/*`, `abi_reflect/src/*_tests.rs`). Enum/FAM changes need success and failure fixtures mirroring the hazards listed in `enum-fams.md` (forward references, recursion, heterogeneous payloads). Whenever you alter an IR node or visitor, update the compliance harnesses (`abi_gen/tests/compliance_harness_rust`, `c_codegen_tests.rs`, TS fixtures) and re-run the parity script so IR-vs-legacy math stays aligned for C/Rust (TypeScript is IR-only).

## Commit & Pull Request Guidelines
Commits stay scope-limited and should name the checklist item in `enums-fam-impl.md` or `implementation-tracking.md`; use prefixes such as `feat:`, `fix:`, `docs:`. PR descriptions must spell out which IR stages/backends changed and list the commands you ran (`cargo test -p abi_gen`, parity script, TS harness).

## Enum + FAM Focus
This codebase exists to make enums with flexible array members portable across C, Rust, and TypeScript. Honor the guardrails in `enum-fams.md`: keep canonical parameter maps, forbid forward-looking size expressions, and encode alignment/endianness in every IR node. TypeScript codegen is fully IR-first; C and Rust should maintain IR-vs-legacy parity comparisons until their migration is complete.

## Documentation Stewardship
Before starting work, read the onboarding docs under `abi/abi_gen/docs/`:
- `pipeline-overview.md`
- `type-resolution-and-dynamic-params.md`
- `layout-ir-and-builder.md`
- `typescript-backend-runtime.md`
- `ir-parity-and-testing.md`

Each file now documents its own update criteria. When your changes satisfy any of those triggers, update the corresponding doc (and its “When to Update” section if the criteria evolve). The expectation is that every contribution keeps these guides accurate and self-healing.
