import { describe, expect, it } from "vitest";

import {
  THRU_API_KEY_PATTERN,
  assertValidThruApiKey,
  isValidThruApiKey,
  resolveThruApiKey,
  thruApiKeyHeader,
} from "../api-key";

const VALID_KEY = "thru_" + "aB3".repeat(10) + "zZ"; // 5 + 32 chars

describe("THRU_API_KEY_PATTERN", () => {
  it("accepts thru_ followed by exactly 32 alphanumerics", () => {
    expect(VALID_KEY).toHaveLength(37);
    expect(THRU_API_KEY_PATTERN.test(VALID_KEY)).toBe(true);
    expect(isValidThruApiKey(VALID_KEY)).toBe(true);
  });

  it("rejects wrong prefix, wrong length and non-alphanumerics", () => {
    expect(isValidThruApiKey("sk_" + "a".repeat(32))).toBe(false);
    expect(isValidThruApiKey("thru_" + "a".repeat(31))).toBe(false);
    expect(isValidThruApiKey("thru_" + "a".repeat(33))).toBe(false);
    expect(isValidThruApiKey("thru_" + "a".repeat(31) + "-")).toBe(false);
    expect(isValidThruApiKey("thru_" + "a".repeat(31) + "_")).toBe(false);
    expect(isValidThruApiKey("THRU_" + "a".repeat(32))).toBe(false);
    expect(isValidThruApiKey("")).toBe(false);
    expect(isValidThruApiKey(undefined)).toBe(false);
    expect(isValidThruApiKey(42)).toBe(false);
  });
});

describe("assertValidThruApiKey", () => {
  it("does not throw for a valid key", () => {
    expect(() => assertValidThruApiKey(VALID_KEY)).not.toThrow();
  });

  it("throws a clear error that does not echo the key", () => {
    const bad = "thru_not-a-real-key";
    expect(() => assertValidThruApiKey(bad)).toThrow(/Invalid Thru API key/);
    expect(() => assertValidThruApiKey(bad)).toThrow(/32 alphanumeric/);
    try {
      assertValidThruApiKey(bad);
    } catch (err) {
      expect((err as Error).message).not.toContain(bad);
    }
  });
});

describe("thruApiKeyHeader", () => {
  it("builds a Bearer Authorization header", () => {
    expect(thruApiKeyHeader(VALID_KEY)).toEqual(["Authorization", `Bearer ${VALID_KEY}`]);
  });

  it("rejects invalid keys", () => {
    expect(() => thruApiKeyHeader("thru_short")).toThrow(/Invalid Thru API key/);
  });
});

describe("resolveThruApiKey", () => {
  it("returns undefined when env is missing or has no key", () => {
    expect(resolveThruApiKey(undefined)).toBeUndefined();
    expect(resolveThruApiKey(null)).toBeUndefined();
    expect(resolveThruApiKey({})).toBeUndefined();
    expect(resolveThruApiKey({ UNRELATED: "x" })).toBeUndefined();
  });

  it("treats blank values as unset", () => {
    expect(resolveThruApiKey({ THRU_API_KEY: "" })).toBeUndefined();
    expect(resolveThruApiKey({ THRU_API_KEY: "   " })).toBeUndefined();
    expect(resolveThruApiKey({ THRU_API_KEY: "", NEXT_PUBLIC_THRU_API_KEY: VALID_KEY })).toBe(VALID_KEY);
  });

  it("prefers THRU_API_KEY, then NEXT_PUBLIC_, then EXPO_PUBLIC_", () => {
    expect(
      resolveThruApiKey({
        THRU_API_KEY: "thru_server",
        NEXT_PUBLIC_THRU_API_KEY: "thru_next",
        EXPO_PUBLIC_THRU_API_KEY: "thru_expo",
      }),
    ).toBe("thru_server");
    expect(
      resolveThruApiKey({
        NEXT_PUBLIC_THRU_API_KEY: "thru_next",
        EXPO_PUBLIC_THRU_API_KEY: "thru_expo",
      }),
    ).toBe("thru_next");
    expect(resolveThruApiKey({ EXPO_PUBLIC_THRU_API_KEY: "thru_expo" })).toBe("thru_expo");
  });

  it("trims surrounding whitespace", () => {
    expect(resolveThruApiKey({ THRU_API_KEY: `  ${VALID_KEY}\n` })).toBe(VALID_KEY);
  });

  it("does not validate the key format (validation happens at client creation)", () => {
    expect(resolveThruApiKey({ THRU_API_KEY: "not-a-key" })).toBe("not-a-key");
  });
});
