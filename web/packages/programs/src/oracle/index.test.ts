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
      "Not an Oracle feed account",
    );
    expect(() => parseOracleEvent(Uint8Array.of(99))).toThrow(
      "Unknown Oracle event type",
    );
    expect(() =>
      parseOracleFeedAccount(fixture("price_feed").subarray(0, 160)),
    ).toThrow("Not an Oracle feed account");
    expect(fixture("price_feed")).toHaveLength(161);
    expect(fixture("boolean_feed")).toHaveLength(146);

    const priceAsBoolean = fixture("price_feed");
    priceAsBoolean[0] = 2;
    expect(() => parseOracleFeedAccount(priceAsBoolean)).toThrow(
      "Not an Oracle feed account",
    );
    expect(() => parseOracleFeedAccount(new Uint8Array(161))).toThrow(
      "Not an Oracle feed account",
    );

    const invalidBoolean = fixture("boolean_feed");
    invalidBoolean[145] = 2;
    expect(() => parseOracleFeedAccount(invalidBoolean)).toThrow(
      "Invalid Oracle boolean value",
    );
  });

  it("pads a short seed and refuses to truncate a long one", () => {
    const seed = normalizeOracleFeedSeed("BTC/USD");
    expect(seed).toHaveLength(32);
    expect(new TextDecoder().decode(seed.subarray(0, 7))).toBe("BTC/USD");
    expect(seed.subarray(7).every((byte) => byte === 0)).toBe(true);

    /* Exactly 32 bytes is the limit, not a truncation point. */
    const full = normalizeOracleFeedSeed("abcdefghijklmnopqrstuvwxyz012345");
    expect(full).toHaveLength(32);

    /* Two labels sharing their first 32 bytes used to derive one feed PDA. */
    const long = "abcdefghijklmnopqrstuvwxyz0123456789";
    expect(() => normalizeOracleFeedSeed(long)).toThrow("at most 32 bytes");
    expect(() => normalizeOracleFeedSeed(long.slice(0, 32) + "different")).toThrow(
      "at most 32 bytes",
    );
    expect(() => normalizeOracleFeedSeed(new Uint8Array(33))).toThrow(
      "at most 32 bytes",
    );
    expect(normalizeOracleFeedSeed(new Uint8Array(32))).toHaveLength(32);
  });

  it("maps program errors", () => {
    expect(oracleProgramErrorFromCode(3n)).toBe(
      OracleProgramError.UnauthorizedOperation,
    );
    expect(oracleProgramErrorFromCode(99)).toBeNull();
  });
});
