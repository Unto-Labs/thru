import { existsSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildLayoutIr,
  ensureWasmLoaded,
  errorVariants,
  reflectError,
  formatReflection,
  reflect,
  reflectAccount,
  reflectEvent,
  reflectInstruction,
} from "../../../src/abi";

const minimalAbi = `
abi:
  package: "test"
  abi-version: 1
  package-version: "1.0.0"
  description: "Test ABI"
  options:
    program-metadata:
      root-types:
        instruction-root: "TestInstruction"
        account-root: "TestAccount"
        errors: "TestError"
        events: "TestEvent"
types:
  - name: "TestInstruction"
    kind:
      struct:
        packed: true
        fields:
          - name: "value"
            field-type:
              primitive: u64
  - name: "TestAccount"
    kind:
      struct:
        packed: true
        fields:
          - name: "value"
            field-type:
              primitive: u64
  - name: "TestError"
    kind:
      struct:
        packed: true
        fields:
          - name: "code"
            field-type:
              primitive: u64
          - name: "error"
            field-type:
              enum:
                tag-ref:
                  field-ref:
                    path: [code]
                variants:
                  - name: "insufficient_funds"
                    tag-value: 7
                    comment: "Source balance is lower than the transfer amount."
                  - name: "crossed_book"
                    tag-value: -101
  - name: "TestEvent"
    kind:
      struct:
        packed: true
        fields:
          - name: "value"
            field-type:
              primitive: u64
`;

const testBytes = new Uint8Array([0x42, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
const testHex = "4200000000000000";
const hasWasmArtifacts = existsSync(
  new URL("../../../wasm/abi/node/abi_reflect_wasm.js", import.meta.url),
);

const describeWasm = hasWasmArtifacts ? describe : describe.skip;

it("reflectInstruction rejects a raw byte array with the expected payload shape", async () => {
  await expect(reflectInstruction(minimalAbi, testBytes as never)).rejects.toThrow(
    'Invalid payload type: expected { type: "binary" | "hex", value }',
  );
  await expect(reflect(minimalAbi, "TestInstruction", undefined as never)).rejects.toThrow(
    'Invalid payload type: expected { type: "binary" | "hex", value }',
  );
});

describeWasm("WASM bridge exports", () => {
  beforeAll(async () => {
    await ensureWasmLoaded();
  });

  it("reflect returns an object from hex input", async () => {
    const result = await reflect(minimalAbi, "TestInstruction", {
      type: "hex",
      value: testHex,
    });
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("reflectInstruction returns an object", async () => {
    const result = await reflectInstruction(minimalAbi, {
      type: "binary",
      value: testBytes,
    });
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("reflectAccount returns an object", async () => {
    const result = await reflectAccount(minimalAbi, {
      type: "binary",
      value: testBytes,
    });
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("reflectEvent returns an object", async () => {
    const result = await reflectEvent(minimalAbi, {
      type: "binary",
      value: testBytes,
    });
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("buildLayoutIr returns layout metadata", async () => {
    const layout = await buildLayoutIr(minimalAbi);
    expect(layout).toBeDefined();
    expect(typeof layout).toBe("object");
  });

  it("formatReflection transforms reflection output", async () => {
    const raw = await reflect(minimalAbi, "TestInstruction", {
      type: "binary",
      value: testBytes,
    });
    const formatted = formatReflection(raw);
    expect(formatted).toBeDefined();
    expect(typeof formatted).toBe("object");
    expect(formatted).toHaveProperty("typeName");
    expect(formatted).toHaveProperty("value");
  });

  it("formatReflection builds display cards from synthetic fields", async () => {
    const abi = minimalAbi.replace(
      `  - name: "TestInstruction"
    kind:
      struct:
        packed: true
        fields:
          - name: "value"
            field-type:
              primitive: u64`,
      `  - name: "TestInstruction"
    kind:
      struct:
        packed: true
        display-name: "Send"
        fields:
          - name: "value"
            user-display: false
            field-type:
              primitive: u64
          - name: "recipient"
            type: synthetic
            return-type: { type-ref: { name: Pubkey } }
            expression: "accountAddress(value - 64)"
            display-name: "Recipient"
            user-display: true`,
    );
    const raw = await reflectInstruction(abi, { type: "binary", value: testBytes });

    /* Real addresses: a computed Pubkey is decoded back to its 32 bytes. */
    const accounts = [
      "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "taABIIUrvJgJ-TotN7GtwSJVlAQH6YlM3Gs0zwULqn8Hrf",
      "taMSIGSw6-X5_VfllGpLXl_yXDZ9ByZD-kO9hUsn-mHIJR",
    ];
    const withAccounts = formatReflection(raw, { accountAddresses: accounts });
    expect(withAccounts.display).toEqual([
      {
        path: [],
        typeName: "TestInstruction",
        title: "Send",
        rows: [
          {
            name: "recipient",
            label: "Recipient",
            source: "synthetic",
            kind: "address",
            value: accounts[2],
            status: "ok",
            expression: "accountAddress(value - 64)",
            returnType: "Pubkey",
          },
        ],
        incomplete: false,
      },
    ]);

    const withoutAccounts = formatReflection(raw);
    expect(withoutAccounts.display?.[0]?.incomplete).toBe(true);
    expect(withoutAccounts.display?.[0]?.rows[0]?.status).toBe("unavailable");
    expect(withoutAccounts.display?.[0]?.rows[0]?.expression).toBe("accountAddress(value - 64)");
    expect(withoutAccounts.display?.[0]?.rows[0]?.returnType).toBe("Pubkey");

    /* The technical tree holds the computed Pubkey in the same shape as a
     * wire one, with its display form. */
    const recipient = (withAccounts.value as Record<string, unknown>).recipient as Record<string, unknown>;
    expect(recipient.address).toBe(accounts[2]);
    expect(recipient.display).toEqual({ kind: "address", text: accounts[2] });
  });

  it("formatReflection computes Decimal fields from exact u64 values", async () => {
    const abi = minimalAbi.replace(
      `  - name: "TestInstruction"
    kind:
      struct:
        packed: true
        fields:
          - name: "value"
            field-type:
              primitive: u64`,
      `  - name: "TestInstruction"
    kind:
      struct:
        packed: true
        display-name: "Amount"
        fields:
          - name: "value"
            user-display: false
            field-type:
              primitive: u64
          - name: "amount"
            type: synthetic
            return-type: { type-ref: { name: Decimal } }
            expression: "toDecimal(value, 0)"
            user-display: true`,
    );
    /* 2^53 + 1: JSON.parse would round it to 2^53. */
    const bytes = new Uint8Array([1, 0, 0, 0, 0, 0, 0x20, 0]);
    const raw = await reflectInstruction(abi, { type: "binary", value: bytes });
    const formatted = formatReflection(raw);
    expect(formatted.display?.[0]?.rows[0]?.value).toBe("9007199254740993");
    expect(formatted.display?.[0]?.rows[0]?.kind).toBe("decimal");
  });

  it("reflectError names a listed revert code", async () => {
    expect(await reflectError(minimalAbi, 7n)).toEqual({
      typeName: "TestError",
      name: "insufficient_funds",
      code: "7",
      comment: "Source balance is lower than the transfer amount.",
    });
  });

  it("reflectError takes a negative code in either reading", async () => {
    const expected = { typeName: "TestError", name: "crossed_book", code: "18446744073709551515" };
    expect(await reflectError(minimalAbi, -101n)).toEqual(expected);
    expect(await reflectError(minimalAbi, "18446744073709551515")).toEqual(expected);
  });

  it("reflectError returns null for a code the ABI does not list", async () => {
    expect(await reflectError(minimalAbi, 2)).toBeNull();
  });

  it("errorVariants lists the errors root in ABI order", async () => {
    const variants = await errorVariants(minimalAbi);
    expect(variants.map((variant) => variant.name)).toEqual(["insufficient_funds", "crossed_book"]);
  });
});
