// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DobInput, type DobInputProps } from "./DobInput";
import { dobToIso } from "./dob";

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

const render = (props: Partial<DobInputProps> = {}) =>
  act(async () =>
    root.render(
      <DobInput
        label="Date of birth"
        value=""
        onValueChange={() => {}}
        {...props}
      />,
    ),
  );

function Controlled({
  onValueChange,
}: {
  onValueChange: (value: string) => void;
}) {
  const [value, setValue] = React.useState("");
  return (
    <DobInput
      label="Date of birth"
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onValueChange(next);
      }}
    />
  );
}

const control = (name: string) => {
  const found = container.querySelector<HTMLInputElement | HTMLSelectElement>(
    `[aria-label="${name}"]`,
  );
  if (!found) throw new Error(`Missing ${name}`);
  return found;
};
const controls = () =>
  Array.from(container.querySelectorAll<HTMLElement>("select, input"));

async function choose(month: string) {
  await act(async () => {
    const select = control("Month");
    select.value = month;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function type(name: string, text: string) {
  await act(async () => {
    const input = control(name);
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("groups a month picker, a day field and a year field under the label", async () => {
  await render();
  const fieldset = container.querySelector("fieldset");
  const legendId = fieldset?.getAttribute("aria-labelledby");
  expect(legendId && document.getElementById(legendId)?.textContent).toBe(
    "Date of birth",
  );
  expect(controls().map((node) => node.getAttribute("aria-label"))).toEqual([
    "Month",
    "Day",
    "Year",
  ]);
  expect(container.querySelector("label")).toBeNull();

  const month = control("Month") as HTMLSelectElement;
  expect(
    Array.from(month.options, (option) => [option.value, option.text]),
  ).toEqual([
    ["", "Month"],
    ...[
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ].map((name, index) => [String(index + 1), name]),
  ]);
  expect(month.options[0].disabled).toBe(true);
  expect(month.getAttribute("autocomplete")).toBe("off");

  for (const [name, maxLength] of [
    ["Day", "2"],
    ["Year", "4"],
  ]) {
    const input = control(name);
    expect(input.getAttribute("placeholder")).toBe(name);
    expect(input.getAttribute("maxlength")).toBe(maxLength);
    expect(input.getAttribute("inputmode")).toBe("numeric");
    expect(input.getAttribute("type")).toBe("text");
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(input.getAttribute("autocorrect")).toBe("off");
    expect(input.getAttribute("autocapitalize")).toBe("off");
    expect(input.getAttribute("spellcheck")).toBe("false");
    expect(input.getAttribute("data-1p-ignore")).toBe("true");
    expect(input.getAttribute("data-lpignore")).toBe("true");
    expect(input.getAttribute("data-form-type")).toBe("other");
  }
  expect(container.querySelector("[name]")).toBeNull();
});

it("shows a stored month-first value as a month name, day and year", async () => {
  await render({ value: "01/02/1990" });
  expect((control("Month") as HTMLSelectElement).selectedOptions[0].text).toBe(
    "January",
  );
  expect(control("Day").value).toBe("02");
  expect(control("Year").value).toBe("1990");
});

it("reports partial values while the user fills the parts in any order, keeping only digits", async () => {
  const onValueChange = vi.fn();
  await act(async () =>
    root.render(<Controlled onValueChange={onValueChange} />),
  );
  await choose("7");
  expect(onValueChange).toHaveBeenLastCalledWith("7//");
  await type("Day", "0x4");
  expect(onValueChange).toHaveBeenLastCalledWith("7/04/");
  expect(document.activeElement).toBe(document.body);
  await type("Year", "19a90");
  expect(onValueChange).toHaveBeenLastCalledWith("7/04/1990");
  expect(dobToIso(onValueChange.mock.lastCall?.[0])).toBe("1990-07-04");
  expect(document.activeElement).toBe(document.body);

  await act(async () =>
    root.render(
      <DobInput label="Date of birth" value="" onValueChange={onValueChange} />,
    ),
  );
  await type("Year", "1990");
  expect(onValueChange).toHaveBeenLastCalledWith("//1990");
  await act(async () =>
    root.render(
      <DobInput
        label="Date of birth"
        value="/4/"
        onValueChange={onValueChange}
      />,
    ),
  );
  await type("Day", "");
  expect(onValueChange).toHaveBeenLastCalledWith("");
});

it("shows one error for the group and marks every part invalid", async () => {
  await render({ value: "2/30/1990", error: "Enter a real date" });
  const errors = Array.from(container.querySelectorAll("p")).filter(
    (node) => node.textContent === "Enter a real date",
  );
  expect(errors).toHaveLength(1);
  for (const node of controls()) {
    expect(node.getAttribute("aria-invalid")).toBe("true");
    expect(
      document.getElementById(node.getAttribute("aria-describedby") ?? ""),
    ).toBe(errors[0]);
  }
  await render({ value: "2/3/1990" });
  for (const node of controls()) {
    expect(node.getAttribute("aria-invalid")).not.toBe("true");
    expect(node.hasAttribute("aria-describedby")).toBe(false);
  }
});

it("disables every part", async () => {
  await render({ disabled: true });
  expect(controls()).toHaveLength(3);
  for (const node of controls())
    expect((node as HTMLInputElement).disabled).toBe(true);
});
