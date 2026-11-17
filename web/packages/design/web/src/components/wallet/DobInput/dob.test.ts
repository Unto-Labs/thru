import { describe, expect, it } from "vitest";
import { dobToIso, formatDob, parseDob, validateDob } from "./dob";

describe("date of birth helpers", () => {
  it.each([
    ["", ""], ["0", "0"], ["070", "07/0"], ["0704", "07/04"],
    ["07041990", "07/04/1990"], ["07/04/199012", "07/04/1990"],
    ["7/4/1990", "74/19/90"], ["a07b04c1990", "07/04/1990"],
  ])("formats %s as %s", (text, expected) => {
    expect(formatDob(text)).toBe(expected);
  });

  it.each(["02/30/2024", "02/29/2023", "02/29/1900", "00/01/1990", "13/01/1990", "01/00/1990", "04/31/1990", "7/4/1990", "01/01/0000", "01/01/19900"])("rejects invalid date %s", (text) => {
    expect(parseDob(text)).toBeNull();
    expect(dobToIso(text)).toBeNull();
  });

  it("accepts leap days and converts to ISO", () => {
    expect(parseDob("02/29/2024")).toEqual({ year: 2024, month: 2, day: 29 });
    expect(parseDob("02/29/2000")).toEqual({ year: 2000, month: 2, day: 29 });
    expect(dobToIso("07/04/1990")).toBe("1990-07-04");
  });

  it.each([
    ["", null], ["07/04/19", "Enter the full date as MM/DD/YYYY"],
    ["02/30/2024", "Enter a real date"], ["12/31/1899", "Enter a real date"],
    ["07/05/2024", "Date of birth can't be in the future"],
    ["01/01/2025", "Date of birth can't be in the future"],
    ["07/04/2024", null], ["01/01/1900", null], ["07/04/1990", null],
  ])("validates %s", (text, expected) => {
    expect(validateDob(text, new Date(2024, 6, 4))).toBe(expected);
  });
});
