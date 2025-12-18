# @thru/abi – WASM-backed ABI reflection

This package is now a thin TypeScript wrapper around the Rust `abi_reflect`
runtime. We compile the Rust crate to WebAssembly, ship both Node + bundler
targets, and expose a small async API for reflecting ABI YAML + binary payloads.
All layout math and validation run inside the Rust engine so TypeScript stays
lightweight and automatically inherits IR upgrades.

---

## Quick start

```ts
import { ensureWasmLoaded, formatReflection, reflect } from "@thru/abi";
import tokenAbi from "./abi/token_program.abi.yaml?raw";

async function example() {
  await ensureWasmLoaded(); // formatter + reflector live inside WASM

  const payload = new Uint8Array([0x01, 0, 0, 0, 0, 0, 0, 0]);
  const reflection = await reflect(tokenAbi, "TokenInstruction", {
    type: "binary",
    value: payload,
  });

  console.log(reflection.value); // JSON emitted by abi_reflect

  // Collapse the verbose JSON tree into something human-readable
  const formatted = formatReflection(reflection);
  console.log(formatted.value.payload.variant); // "initialize_mint"
}

example();
```

* The ABI text **must already be flattened** (imports resolved). The Rust
  resolver enforces this.
* Results are JSON blobs straight from `serde_json`. They include the full type
  info + value trees used by the CLI tooling.

---

## Public API

| Function | Description |
| --- | --- |
| `reflect(abi: string, typeName: string, payload: { type: "binary", value: BinaryLike } \| { type: "hex", value: string })` | Reflects binary data (or hex) and returns the parsed JSON payload. |
| `formatReflection(raw: JsonValue)` | Delegates to the WASM formatter to collapse verbose JSON trees. Requires `ensureWasmLoaded()` (or any prior call to `reflect`) before use. |
| `buildLayoutIr(abi: string)` | Runs the shared Layout IR builder and returns the serialized IR document (schema version, per-type expressions, parameters). |
| `ensureWasmLoaded()` | Preloads the WASM bindings for callers that want to pay the initialization cost up-front. `reflect` calls it lazily. |

All helpers are async, because loading + instantiating the WASM module can touch
the filesystem (Node) or issue dynamic imports (bundlers).

---

## WASM workflow

The generated artifacts live under `web/packages/abi/wasm/{bundler,node}` and are
checked in so the package works without a local Rust toolchain. When
`abi_reflect` or the shared IR changes, rebuild everything with:

```bash
# From repo root
pnpm --filter @thru/abi run build:wasm
```

That script runs `wasm-pack build` twice (bundler + node targets) inside
`abi/abi_reflect_wasm`, then copies the fresh outputs into
`web/packages/abi/wasm`. The regular `pnpm --filter @thru/abi build` step runs
`tsup` and copies those WASM folders into `dist/wasm` so published packages
resolve the dynamic imports automatically.

When developing inside the monorepo, Vitest loads the TypeScript sources
directly. The runtime detects when it is executing from `src/` and reaches for
`../wasm`, so make sure the synced artifacts exist before running the tests.

---

## Testing

```bash
pnpm --filter @thru/abi test
```

Vitest exercises both `reflectHex` and `reflectBinary` against the
`SimpleStruct` compliance ABI plus `buildLayoutIr` to ensure the WASM bridge is
wired correctly. If you tweak the Rust runtime, rerun `pnpm build:wasm` so the
tests pick up the updated binaries.

---

## Development notes

* The TypeScript surface intentionally stays tiny; we no longer export the old
  decoder/resolver classes. Future code should talk to the WASM bridge instead
  of re-implementing reflection logic in JS.
* Browser vs. Node detection happens in `src/wasmBridge.ts`. Node loads the
  `wasm/node` build via `createRequire`, while bundlers dynamically import the
  `wasm/bundler` module.
* The JSON shape returned by `reflect*` matches `abi_reflect`'s CLI output, so
  parity debugging can use `abi/scripts/show_reflection.py`.
* Layout IR consumers can feed `buildLayoutIr` into caches or ship a prebuilt
  snapshot alongside the WASM runtime to guard against future schema changes.

---

Questions? Ping the thru-net ABI team (same folks maintaining
`abi/abi_reflect`). Whenever you extend the Rust reflection engine or shared IR,
regenerate the WASM artifacts and mention the change in `enums-fam-impl.md` so
tooling consumers know which version to depend on.
