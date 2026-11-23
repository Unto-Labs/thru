// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CountryPicker } from "./CountryPicker";

const countries = ["US", "MX", "CW"];
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function countryOptions() {
  return Array.from(
    document.body.querySelectorAll<HTMLElement>('[role="option"]'),
  );
}

async function searchCountries(query: string) {
  const search = document.body.querySelector<HTMLInputElement>(
    'input[aria-label="Search countries"]',
  );
  expect(search).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(search, query);
    search?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("searches caller-supplied countries by code and name and emits the selected code", async () => {
  const onSelect = vi.fn();
  function Example() {
    const [country, setCountry] = React.useState("US");
    return (
      <CountryPicker
        countries={countries}
        value={country}
        label="Country"
        onValueChange={(code) => {
          setCountry(code);
          onSelect(code);
        }}
      />
    );
  }

  await act(async () => root.render(<Example />));
  const trigger =
    container.querySelector<HTMLButtonElement>('[role="combobox"]');
  expect(trigger?.textContent).toBe("United States");
  await act(async () => trigger?.click());
  expect(
    countryOptions().map((option) => option.getAttribute("aria-label")),
  ).toEqual(["United States", "Mexico", "Curaçao"]);

  await searchCountries("UAE");
  expect(countryOptions()).toHaveLength(0);

  await searchCountries("mx");
  expect(
    countryOptions().map((option) => option.getAttribute("aria-label")),
  ).toEqual(["Mexico"]);
  await searchCountries("curacao");
  const options = countryOptions();
  expect(options.map((option) => option.getAttribute("aria-label"))).toEqual([
    "Curaçao",
  ]);
  await act(async () => options[0].click());
  expect(onSelect).toHaveBeenCalledExactlyOnceWith("CW");
  expect(trigger?.textContent).toBe("Curaçao");
});

it.each([
  [" uK ", "GB"],
  ["USA", "US"],
  ["America", "US"],
  ["Korea", "KR"],
  ["Holland", "NL"],
  ["Holl", "NL"],
  ["UAE", "AE"],
])("finds %s by its alias and emits %s", async (query, code) => {
  const onValueChange = vi.fn();
  await act(async () =>
    root.render(
      <CountryPicker
        countries={["GB", "US", "KR", "NL", "AE"]}
        label="Country"
        value={null}
        onValueChange={onValueChange}
      />,
    ),
  );
  const trigger =
    container.querySelector<HTMLButtonElement>('[role="combobox"]');
  await act(async () => trigger?.click());
  await searchCountries(query);
  const options = countryOptions();
  expect(options).toHaveLength(1);
  await act(async () => options[0].click());
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith(code);
});

it("shows a reason for a blocked country and prevents selecting it", async () => {
  const onValueChange = vi.fn();
  await act(async () =>
    root.render(
      <CountryPicker
        countries={countries}
        value="US"
        label="Country"
        blocked={{ MX: "Unavailable in Mexico" }}
        onValueChange={onValueChange}
      />,
    ),
  );
  const trigger =
    container.querySelector<HTMLButtonElement>('[role="combobox"]');
  await act(async () => trigger?.click());
  await searchCountries("Mexico");
  const options = countryOptions();
  expect(options).toHaveLength(1);
  expect(options[0].getAttribute("aria-disabled")).toBe("true");
  expect(options[0].getAttribute("aria-label")).toBe(
    "Mexico. Unavailable in Mexico",
  );
  expect(options[0].textContent).toContain("Unavailable in Mexico");
  await act(async () => options[0].click());
  expect(onValueChange).not.toHaveBeenCalled();
  expect(trigger?.textContent).toBe("United States");
});

it("links the field's label and validation error to its disabled trigger", async () => {
  await act(async () =>
    root.render(
      <CountryPicker
        countries={countries}
        id="country"
        label="Country"
        value={null}
        error="Choose a country"
        disabled
        onValueChange={() => {}}
      />,
    ),
  );
  const trigger = container.querySelector<HTMLButtonElement>(
    "button#country[role=combobox]",
  );
  expect(trigger?.disabled).toBe(true);
  expect(trigger?.getAttribute("aria-invalid")).toBe("true");
  const label = document.getElementById(
    trigger?.getAttribute("aria-labelledby") ?? "",
  );
  expect(label?.textContent).toBe("Country");
  expect(label?.classList.contains("tds-field__label")).toBe(true);
  const error = document.getElementById(
    trigger?.getAttribute("aria-describedby") ?? "",
  );
  expect(error?.textContent).toBe("Choose a country");
  expect(error?.classList.contains("tds-field__error")).toBe(true);
});
