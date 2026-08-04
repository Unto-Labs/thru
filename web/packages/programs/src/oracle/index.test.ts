import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  normalizeOracleFeedSeed,
  OracleProgramError,
  oracleProgramErrorFromCode,
  parseOracleEvent,
  parseOracleFeedAccount,
} from "./index";

function fixture(name: string): Uint8Array {
  const url = new URL(
    `../../../../../rpc/thru-oracle-sdk/tests/fixtures/${name}.hex`,
    import.meta.url,
  );
  return Uint8Array.from(Buffer.from(readFileSync(url, "utf8").trim(), "hex"));
}

describe("Oracle read helpers", () => {
  it("decodes shared price and boolean feed fixtures", () => {
    const price = parseOracleFeedAccount(fixture("price_feed"));
    expect(price.kind).toBe("price");
    if (price.kind !== "price") throw new Error("expected price feed");
    expect(price.common.feedName).toBe("BTC/USD");
    expect(price.price).toBe(42_000n);
    expect(price.maxVarianceBps).toBe(500);
    expect(price.exponent).toBe(-8);

    const boolean = parseOracleFeedAccount(fixture("boolean_feed"));
    expect(boolean.kind).toBe("boolean");
    if (boolean.kind !== "boolean") throw new Error("expected boolean feed");
    expect(boolean.value).toBe(true);
  });

  it("decodes shared price and boolean event fixtures", () => {
    const price = parseOracleEvent(fixture("price_event"));
    expect(price.kind).toBe("priceUpdate");
    if (price.kind !== "priceUpdate") throw new Error("expected price update");
    expect(price.oldPrice).toBe(41_000n);
    expect(price.newPrice).toBe(42_000n);

    const boolean = parseOracleEvent(fixture("boolean_event"));
    expect(boolean.kind).toBe("booleanUpdate");
    if (boolean.kind !== "booleanUpdate")
      throw new Error("expected boolean update");
    expect(boolean.oldValue).toBe(false);
    expect(boolean.newValue).toBe(true);
  });

  it("rejects malformed tags, lengths, and boolean values", () => {
    expect(() => parseOracleFeedAccount(Uint8Array.of(99))).toThrow(
      "Unknown Oracle feed type",
    );
    expect(() => parseOracleEvent(Uint8Array.of(99))).toThrow(
      "Unknown Oracle event type",
    );
    expect(() =>
      parseOracleFeedAccount(fixture("price_feed").subarray(0, 160)),
    ).toThrow("expected 161 bytes");

    const invalidBoolean = fixture("boolean_feed");
    invalidBoolean[145] = 2;
    expect(() => parseOracleFeedAccount(invalidBoolean)).toThrow(
      "Invalid Oracle boolean value",
    );
  });

  it("normalizes seeds and maps program errors", () => {
    const seed = normalizeOracleFeedSeed(
      "abcdefghijklmnopqrstuvwxyz0123456789",
    );
    expect(seed).toHaveLength(32);
    expect(new TextDecoder().decode(seed)).toBe(
      "abcdefghijklmnopqrstuvwxyz012345",
    );
    expect(oracleProgramErrorFromCode(3n)).toBe(
      OracleProgramError.UnauthorizedOperation,
    );
    expect(oracleProgramErrorFromCode(99)).toBeNull();
  });
});
