import { describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes } from "./bytes";

describe("ABI hexToBytes", () => {
  it.each(["1g", "fZ", "0x1g", "-1", "+1", "00-1", "00+1", "g1", "12q3"])(
    "rejects malformed hexadecimal input %j",
    (input) => {
      expect(() => hexToBytes(input)).toThrow(
        "Hex input contains non-hexadecimal characters",
      );
    },
  );

  it.each(["abc", "0x1", "0X0_12"])("rejects odd-length input %j", (input) => {
    expect(() => hexToBytes(input)).toThrow(
      "Hex input must contain an even number of characters",
    );
  });

  it.each(["00abFF", "0x00abFF", "0X00ABff", " \n0X00_ab\tFF \r\n"])(
    "preserves supported formatting in %j",
    (input) => {
      expect(hexToBytes(input)).toEqual(new Uint8Array([0x00, 0xab, 0xff]));
    },
  );

  it.each(["", " \t\n_", "0x", "0X _"])("accepts empty input %j", (input) => {
    expect(hexToBytes(input)).toEqual(new Uint8Array());
  });

  it("round-trips every byte value", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes);
  });
});
