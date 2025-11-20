# @thru/abi – TypeScript ABI Reflection Layer

This package provides a browser-friendly ABI reflection+decoding engine that matches the thru-net on-chain ABI semantics. The goal is to let Explorer-grade UIs take any **flattened ABI YAML** plus raw account bytes and produce fully structured, well-annotated decoded values without generating code ahead of time.

The README is intentionally verbose so a future engineer (human or AI) can understand the full behavior surface without spelunking through source.

---

## Quick Start

```ts
import { decodeData } from "@thru/abi";
import myAbi from "./abi/counter.abi.yaml?raw";

const decoded = decodeData(myAbi, "CounterAccount", accountDataUint8Array);

if (decoded.kind === "struct") {
  console.log(decoded.fields.count);
}
```

* `decodeData(yamlText, typeName, data)` is the only public runtime API.
* `yamlText` **must be flattened** (imports already resolved). This is enforced at parse time.
* The returned `DecodedValue` tree contains both semantic data and raw byte slices for UI inspection.

---

## Package Layout

| Path | Purpose |
| ---- | ------- |
| `src/abiSchema.ts` | YAML parser + TypeScript interfaces aligned with the thru-net ABI schema. |
| `src/typeRegistry.ts` | Builds validated registry, resolves type refs, detects cycles. |
| `src/decoder.ts` | Core reflection engine. Handles arrays, structs, unions, enums, SDUs, padding, f16, etc. |
| `src/expression.ts` | Evaluates ABI expressions (field refs, arithmetic, bitwise, sizeof/alignof). |
| `src/decodedValue.ts` | Canonical decoded shape consumed by Explorer UI. |
| `test/` | Hand-authored fixtures mirroring Rust compliance tests (e.g., `structs.abi.yaml`). |

---

## Feature Matrix

### ✅ Implemented

* **Schema Parsing**
  * Matches the thru-net ABI AST (primitives, structs, arrays, unions, enums, size-discriminated unions, type-refs).
  * Validates flattened files (no `imports`), duplicate names, dangling refs, type cycles.

* **Expression Engine**
  * Literals (u/i 8–64), field references with lexical scopes (`["..","parent"]` supported).
  * Arithmetic: `add`, `sub`, `mul`, `div`, `mod`.
  * Bitwise: `bit-and`, `bit-or`, `bit-xor`, `bit-not`, `left-shift`, `right-shift`.
  * Meta: `sizeof(type-name)`, `alignof(type-name)` leveraging shared footprint helpers.

* **Decoding Semantics**
  * **Structs:** assumes `packed: true` containers (our blockchain layout never inserts padding). `aligned` overrides are reserved for future use.
  * **Arrays:** dynamic element count via expressions referencing previously decoded fields.
  * **Enums:** tag derived from expressions; variant payload decoded inline.
  * **Unions:** best-effort “preview all variants” strategy—each variant is decoded in isolation, results presented side-by-side (important for Explorer UX).
  * **Size-Discriminated Unions:** tries each variant with byte budgets, supports placement mid-struct by reserving trailing fixed sizes.
  * **Type-Refs:** recursion-safe (cycle detection done in registry); `decodeKind` transparently resolves nested refs.
  * **Primitives:** all integer + float types from ABI spec, including `f16` (returned as `number` representing raw `u16` for now).

* **DecodedValue Shape**
  * Each node exposes `kind`, `typeName`, `byteOffset`, `byteLength`, `rawHex`.
  * Structs provide both `fields` (object) and `fieldOrder` (array preserving declaration order).
  * Arrays expose `length`, `elements`.
  * Enums/Unions/SDUs capture tag or variant metadata.
  * When something can’t be safely decoded (e.g., ambiguous union variant), an `opaque` node contains context + `rawHex`.

* **Testing Harness**
  * Uses `tsx`/`vitest`. The repo includes sample fixture script `test/verify-rectangle.ts` showing end-to-end usage.
  * Additional tests exist under `src/index.test.ts` covering primitives, arrays, expressions, unions, etc.

### ⚠️ Known Limitations (as of this snapshot)

* **Runtime Performance**
  * YAML is parsed on every `decodeData` call. No caching or schema memoization yet.
  * Expressions evaluate with BigInt math. That’s correct but slower than precomputed constants.

* **Instruction Decoding**
  * Current focus is account data. Instruction decoding isn’t implemented yet (needs call-site context + discriminants).

* **Union Heuristics**
  * Unlike Rust (which requires external hints), we decode *every* variant. That’s user-friendly but does not pick a “canonical” variant automatically. Upstream UI must choose how to present ambiguous unions.

* **Float16 Conversion**
  * We currently return the raw `u16` bits. A helper to convert to IEEE-754 half floats can be added later if needed for display accuracy.

* **Error Surfacing**
  * Errors throw `AbiParseError`, `AbiValidationError`, or `AbiDecodeError`. Explorer code should catch and surface the message. There’s no structured warning channel yet (e.g., partial decodes).

* **Security / Untrusted ABIs**
  * The parser enforces flattened files and forbids unknown fields, but we still assume ABIs come from trusted sources. Malicious ABIs could attempt to trick UIs (e.g., wrong type names). A future enhancement could add allow-lists or signatures.

---

## How Decoding Works (Step-by-step)

1. **Parse & Validate**
   * `parseAbiDocument` -> `AbiDocument`.
   * `buildTypeRegistry` indexes types, verifies refs, catches cycles.

2. **Prepare State**
   * `decodeData` creates `DecodeState` (`Uint8Array`, `DataView`, root scope).

3. **Walk Type Tree**
   * `decodeKind` dispatches by `kind` (primitive, struct, array, etc.).
   * Each decoder carries a byte budget so flexible members can live mid-struct while respecting trailing fixed-size fields.

4. **Field Scope & Expressions**
   * After each field decode, `addFieldToScope` records the result so later `field-ref`s can use it.
   * Expressions are evaluated lazily during decoding (e.g., array lengths, enum tags).

5. **Alignment Rules**
   * Structs are emitted and decoded as `packed: true`, so offsets advance exactly by the previous field’s byte length.
   * Alignment metadata is currently ignored because thru-net ABIs never request padding.

6. **Result Assembly**
   * Every decoded chunk captures offset, size, and raw hex slice so UIs can show byte-level views alongside structured data.

---

## CLI / Development Workflow

```bash
# Install deps
pnpm install

# Build ESM bundle + type declarations
pnpm --filter @thru/abi build

# Run test suite (vitest)
pnpm --filter @thru/abi test

# One-off verification script example
npx tsx web/packages/abi/test/verify-rectangle.ts
```

CI typically runs `build` and `test`. The package outputs ESM suitable for modern bundlers (Vite, Next.js, etc.).

---

## Integration Guidance

* **Explorer**
  * Keep ABIs as `.yaml` + `.bin` fixtures or embed them using `?raw`.
  * Wrap `decodeData` in a try/catch; surface errors in the UI.
  * Use `fieldOrder` to render tables with deterministic ordering.
  * Use `rawHex` for fallback views when a field type is `opaque`.

* **Other Consumers**
  * Libraries/tools can reuse `parseAbiDocument` + `TypeRegistry` to build higher-level abstractions (e.g., caching parsed schemas, precomputing footprints).

---

## Future Roadmap Ideas

1. **Schema Caching** – hash YAML text and reuse parsed `AbiDocument`/`TypeRegistry`.
2. **Instruction Decoding** – need discriminants + context (program ID, variant mapping).
3. **Float16 Conversion Helper** – convert raw u16 to JS number with proper rounding.
4. **Diagnostics API** – return warnings for ambiguous unions, unsupported expressions, etc., instead of throwing.
5. **Web Worker Integration** – offload heavy decodes to worker threads for large accounts.

---

## Support / Contact

* Code owner: thru-net Explorer team.
* If something decodes differently from the Rust validator, cross-check against the reference implementation under `abi/abi_reflect` and open an issue referencing the specific ABI + binary pair.
* When adding new ABI features, update both this README and `GAPS_AND_PLAN.md` so future iterations know the exact capability boundaries.

Happy decoding! 🎯

