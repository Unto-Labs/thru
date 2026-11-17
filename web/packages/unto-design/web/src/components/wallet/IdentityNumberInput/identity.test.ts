import { describe, expect, it } from "vitest";
import { IDENTITY_FORMATS } from "./identity";

describe("identity formats", () => {
  it("supports only SSN and normalizes to at most nine digits", () => {
    expect(IDENTITY_FORMATS.ssn.normalize("a123-45-67890")).toBe("123456789");
    expect(Object.keys(IDENTITY_FORMATS)).toEqual(["ssn"]);
  });

  it.each([
    ["", ""], ["1", "1"], ["123", "123"], ["1234", "123-4"],
    ["12345", "123-45"], ["123456", "123-45-6"], ["123456789", "123-45-6789"],
  ])("formats SSN %s", (raw, display) => {
    expect(IDENTITY_FORMATS.ssn.format(raw)).toBe(display);
  });

  it("leaves required validation to the form", () => {
    for (const fmt of Object.values(IDENTITY_FORMATS)) expect(fmt.validate("")).toBeNull();
  });

  it.each(["000123456", "666123456", "900123456", "999123456", "123004567", "123450000", "abcdefghi"])("rejects invalid SSN %s", (raw) => {
    expect(IDENTITY_FORMATS.ssn.validate(raw)).toBe("Enter a valid SSN");
  });

  it("validates complete identities and reports incomplete values", () => {
    expect(IDENTITY_FORMATS.ssn.validate("1234")).toBe("Enter all 9 digits");
    expect(IDENTITY_FORMATS.ssn.validate("123456789")).toBeNull();
  });
});
