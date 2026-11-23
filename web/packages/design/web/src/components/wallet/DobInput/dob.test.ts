import { describe, expect, it } from "vitest";
import { dobToIso, parseDob, validateDob } from "./dob";

describe("date of birth helpers", () => {
  it.each([
    "02/30/2024",
    "02/29/2023",
    "02/29/1900",
    "00/01/1990",
    "13/01/1990",
    "01/00/1990",
    "04/31/1990",
    "01/01/0000",
    "01/01/19900",
    "01/01/990",
    "7/4/90",
    "123/4/1990",
    "7//1990",
    "",
    "07041990",
  ])("rejects invalid date %j", (text) => {
    expect(parseDob(text)).toBeNull();
    expect(dobToIso(text)).toBeNull();
  });

  it("accepts leap days and converts to ISO", () => {
    expect(parseDob("02/29/2024")).toEqual({ year: 2024, month: 2, day: 29 });
    expect(parseDob("02/29/2000")).toEqual({ year: 2000, month: 2, day: 29 });
    expect(dobToIso("07/04/1990")).toBe("1990-07-04");
  });

  it("reads month, day and year with or without leading zeros", () => {
    expect(dobToIso("7/4/1990")).toBe("1990-07-04");
    expect(dobToIso("07/4/1990")).toBe("1990-07-04");
    expect(dobToIso("7/04/1990")).toBe("1990-07-04");
    expect(dobToIso("01/02/1990")).toBe("1990-01-02");
    expect(dobToIso("1/23/1990")).toBe("1990-01-23");
  });

  it.each([
    ["", null],
    ["7//", "Enter the month, day and year"],
    ["7/4/", "Enter the month, day and year"],
    ["/4/1990", "Enter the month, day and year"],
    ["7//1990", "Enter the month, day and year"],
    ["//1990", "Enter the month, day and year"],
    ["02/30/2024", "Enter a real date"],
    ["12/31/1899", "Enter a real date"],
    ["7/4/199", "Enter a real date"],
    ["07/05/2024", "Date of birth can't be in the future"],
    ["01/01/2025", "Date of birth can't be in the future"],
    ["07/04/2024", null],
    ["01/01/1900", null],
    ["07/04/1990", null],
    ["7/4/1990", null],
  ])("validates %j", (text, expected) => {
    expect(validateDob(text, new Date(2024, 6, 4))).toBe(expected);
  });
});
