import { describe, expect, it } from "vitest";
import { IDENTITY_FORMATS } from "./identity";

describe("identity formats", () => {
  it("normalizes SSN to at most nine digits", () => {
    expect(IDENTITY_FORMATS.ssn.normalize("a123-45-67890")).toBe("123456789");
  });

  it("keeps a bank account number as 4 to 17 ungrouped digits", () => {
    const { normalize, format, validate } = IDENTITY_FORMATS.bank_account;
    expect(normalize("12 34-5678a")).toBe("12345678");
    expect(normalize("1".repeat(20))).toBe("1".repeat(17));
    expect(format("12345678")).toBe("12345678");
    expect(format("1".repeat(20))).toBe("1".repeat(17));
    expect(validate("123")).toBe("Enter 4 to 17 digits");
    expect(validate("1234")).toBeNull();
    expect(validate("1".repeat(17))).toBeNull();
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

  it("preserves letters, spaces, and punctuation in an ID number", () => {
    const id = "ÄB-12 / Z";
    expect(IDENTITY_FORMATS.id.normalize(id)).toBe(id);
    expect(IDENTITY_FORMATS.id.format(id)).toBe(id);
    expect(IDENTITY_FORMATS.id.validate(id)).toBeNull();
  });

  it("accepts 1 to 64 characters with at least one non-whitespace character", () => {
    const limit = "A".repeat(64);
    expect(IDENTITY_FORMATS.id.validate(" ")).toBe("Enter an ID number");
    expect(IDENTITY_FORMATS.id.validate("A")).toBeNull();
    expect(IDENTITY_FORMATS.id.validate(limit)).toBeNull();
    expect(IDENTITY_FORMATS.id.validate(limit + "Z")).toBe(
      "Enter at most 64 characters",
    );
    expect(IDENTITY_FORMATS.id.normalize(limit + "Z")).toBe(limit);
  });
});
