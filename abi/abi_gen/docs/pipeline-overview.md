# ABI Toolchain Pipeline Overview

This note gives new contributors a single view of the ABI generator’s end‑to‑end flow so they can reason about where to add functionality or debug issues without spelunking the entire tree.

## Control Flow

1. **CLI front-end** (`abi/abi_gen/src/main.rs`, `cmds/mod.rs`)
   - `abi codegen` and `abi analyze` share the same parsing layer.
   - Subcommands only differ in their terminal action; everything up to type resolution is identical.
2. **Import resolution** (`abi/abi_gen/src/abi/file.rs`)
   - `ImportResolver::load_file_with_imports` recursively walks include paths, dedupes files, records package metadata, and accumulates raw `TypeDef`s.
   - Normalization (`cmds/common.rs::normalize_type_refs`) strips fully qualified package prefixes so downstream logic can compare short names.
3. **Dependency analysis & validation** (`abi/abi_gen/src/dependency.rs`)
   - Captures structural dependencies (type refs, field refs, size expressions) and layout constraints (size-affecting fields, FAM ordering rules).
   - `analyze_and_resolve_types()` prints issues during `abi analyze` and fails `abi codegen` if any cycle/violation/validation error remains.
4. **Type resolution** (`abi/abi_gen/src/abi/resolved.rs`)
   - Produces `ResolvedType` objects with concrete sizes, offsets, alignments, and a **dynamic parameter map** (fully qualified references to runtime-only values such as counts, tags, payload sizes).
   - Enforces forward-reference bans, ensures enums with heterogenous payload sizes surface `Size::Variable`, and wires in size-discriminated union invariants per `abi/enum-fams.md`.
5. **Layout graph + IR build** (`abi/abi_gen/src/abi/layout_graph.rs`, `codegen/shared/builder.rs`)
   - `LayoutGraph` deterministically topologically sorts types to guarantee a stable emission order and detect recursive cycles.
   - `IrBuilder` converts each `ResolvedType` into a shared `TypeIr` tree (const/field-ref/switch/call-nested nodes with per-node metadata).
6. **Language backends**
   - **C** (`codegen/c`), **Rust** (`codegen/rust`), **TypeScript** (`codegen/ts`). Each backend receives `ResolvedType`s and (when supported) the shared `TypeIr`.
   - `abi codegen` buckets types by package using `ImportResolver::get_package_for_type` and writes per-package directories.
   - `abi analyze` can dump IR (`--print-ir`) or view backend previews (`--print-footprint`, `--print-validate`) without writing files.

The diagram below summarizes the pipeline. Boxes show modules; arrows show data artifacts.

```
CLI (main.rs)
   │
   ▼
ImportResolver ──> normalized TypeDefs
   │
   ▼
Dependency Analyzer
   │ (halts on cycles/layout violations)
   ▼
TypeResolver ──> ResolvedTypes (+ dynamic params)
   │
   ▼
LayoutGraph ──> topo order ─► IrBuilder ──> TypeIr
   │                                 │
   ├─────────────► backends consume ◄┘
   ▼
C / Rust / TS emitters
```

## Extension Points

### Adding a new CLI flag or subcommand
1. Extend `Cli` / `Commands` in `src/main.rs`.
2. Add a handler in `cmds/<new>.rs` that mirrors the existing pattern: build an `ImportResolver`, normalize names, run `analyze_and_resolve_types`, then branch into whatever new work is needed.

### Consuming the shared IR in a backend
1. Build `TypeIr` using `IrBuilder::build_type` or `build_all`. Handle `IrBuildError` explicitly—forward these to the user rather than swallowing them.
2. Serialize to JSON/Protobuf with `codegen::shared::serialization` if you need to hand the IR to external tooling.
3. Update your emitter to use IR math. TypeScript is fully IR-first (legacy removed); C and Rust still maintain legacy code as a parity check during migration.

### Adding schema validation rules
1. Decide if the rule belongs in the dependency analyzer (structural/layout) or the resolver (semantic, once types are known).
2. Implement the check and return descriptive `LayoutConstraintViolation` or `ResolutionError` variants.
3. Update `abi/analyze` output to surface the new error so authors can fix schemas without running codegen.

## Debugging Checklist

| Symptom | Likely stage | Suggested probe |
|---------|--------------|-----------------|
| Missing types, FQDN mismatches | Import resolution | `abi analyze -f <file> -v` to see package list and import graph |
| “Forward field reference” errors | Type resolution | Inspect offending struct, ensure size expressions reference previous siblings only |
| IR build failures (`IrBuildError::*`) | IrBuilder | Run `abi analyze --print-ir` to dump the failing type and inspect dynamic params |
| Backend code lacks new fields or params | Backend grouping | Confirm `ImportResolver::get_package_for_type` returns the expected package |

### Tips
- Use `abi analyze --print-ir --ir-format json` early; it fails faster than running full codegen.
- When touching backends, prefer regenerating a single compliance case (`abi/scripts/run_ir_parity_checks.py --case <name>`) so you can diff the generated artifacts quickly.

## When to Update This Document

Refresh this overview whenever:

- The CLI interface (subcommands/flags) changes the pipeline flow or introduces new stages.
- Import resolution, dependency analysis, or type resolution gains/removes steps or invariants.
- The shared IR builder or backend integration order changes (e.g., new intermediate artifacts, additional languages).
- New tooling or commands become part of the standard workflow so onboarding readers know where to plug in.
