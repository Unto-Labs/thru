import { describe, expect, it } from "vitest";
import { US_STATES, matchesUsState, usStateOptionLabel, usStateOptions } from "./usStates";

it("contains the 50 states, DC and Puerto Rico with unique codes in name order", () => {
  expect(US_STATES).toHaveLength(52);
  expect(new Set(US_STATES.map((state) => state.code)).size).toBe(52);
  expect(US_STATES.map((state) => state.code)).toEqual(expect.arrayContaining(["DC", "PR"]));
  const names = US_STATES.map((state) => state.name);
  expect(names).toEqual([...names].sort());
});

it("blocks nothing by default", () => {
  expect(usStateOptions().every((option) => option.blockedReason === undefined)).toBe(true);
});

describe("state matching", () => {
  it.each([
    ["new", ["NH", "NJ", "NM", "NY"]],
    ["NY", ["NY"]],
    ["york", ["NY"]],
    ["va", ["VA"]],
    ["  new  ", ["NH", "NJ", "NM", "NY"]],
    ["zz", []],
  ])("matches %s at code or word starts", (query, codes) => {
    expect(usStateOptions().filter((option) => matchesUsState(option, query)).map((option) => option.code)).toEqual(codes);
  });

  it("matches all states for blank queries", () => {
    expect(usStateOptions().filter((option) => matchesUsState(option, "   "))).toHaveLength(52);
  });

  it("keeps blocked states findable with their caller-supplied reasons", () => {
    const matches = usStateOptions({ NY: "Not available in New York" }).filter((option) => matchesUsState(option, "new york"));
    expect(matches).toEqual([{ code: "NY", name: "New York", blockedReason: "Not available in New York" }]);
  });
});

it("names options with their reason when blocked", () => {
  expect(usStateOptionLabel({ code: "CA", name: "California" })).toBe("California");
  expect(usStateOptionLabel({ code: "NY", name: "New York", blockedReason: "Not available in New York" })).toBe("New York. Not available in New York");
});
