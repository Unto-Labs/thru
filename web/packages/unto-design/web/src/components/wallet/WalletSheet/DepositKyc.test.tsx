// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WalletSheet } from "./WalletSheet";
import type { WalletSheetDepositKycProps } from "./DepositKyc";

const values: WalletSheetDepositKycProps["values"] = {
  firstName: "",
  lastName: "",
  email: "jamie@example.com",
  phone: "4155550121",
  street: "",
  apartment: "",
  city: "",
  state: null,
  zip: "",
  ssn: "",
  dob: "",
};
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("renders US-only fields and prevents native form submission", async () => {
  const onSubmit = vi.fn();
  await act(async () =>
    root.render(
      <WalletSheet.DepositKyc
        values={values}
        onFieldChange={() => {}}
        onSubmit={onSubmit}
      />,
    ),
  );
  for (const label of [
    "First name",
    "Last name",
    "Email",
    "Phone",
    "Home address",
    "City",
    "State",
    "ZIP",
    "SSN",
    "Date of birth",
    "Sent to Brale. Never stored by us.",
  ])
    expect(container.textContent).toContain(label);
  expect(
    container.querySelectorAll("input:not([aria-hidden=true])"),
  ).toHaveLength(10);
  expect(container.querySelector("[name], [action], [method]")).toBeNull();
  const event = new Event("submit", { bubbles: true, cancelable: true });
  await act(async () => container.querySelector("form")?.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(onSubmit).toHaveBeenCalledTimes(1);
});
it("locks inputs, picker, reveal and submit while submitting", async () => {
  await act(async () =>
    root.render(
      <WalletSheet.DepositKyc
        values={values}
        disabled
        submitting
        onFieldChange={() => {}}
        onSubmit={() => {}}
      />,
    ),
  );
  for (const control of container.querySelectorAll<
    HTMLInputElement | HTMLButtonElement
  >("input, button"))
    expect(control.disabled).toBe(true);
});
it("focuses the first invalid control for every error attempt", async () => {
  await act(async () =>
    root.render(
      <WalletSheet.DepositKyc
        values={values}
        errors={{ zip: "Invalid ZIP" }}
        errorAttempt={1}
        onFieldChange={() => {}}
        onSubmit={() => {}}
      />,
    ),
  );
  expect(document.activeElement).toBe(
    container.querySelector('[aria-invalid="true"]'),
  );
});
it("lists DC and PR and prevents selecting a blocked state", async () => {
  const onFieldChange = vi.fn();
  await act(async () =>
    root.render(
      <WalletSheet.DepositKyc
        values={values}
        blockedStates={{ TX: "Not available in Texas" }}
        onFieldChange={onFieldChange}
        onSubmit={() => {}}
      />,
    ),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[role="combobox"]')?.click(),
  );
  const options = Array.from(
    document.body.querySelectorAll<HTMLElement>('[role="option"]'),
  );
  expect(
    options.some((option) =>
      option.textContent?.includes("District of Columbia"),
    ),
  ).toBe(true);
  expect(
    options.some((option) => option.textContent?.includes("Puerto Rico")),
  ).toBe(true);
  const texas = options.find((option) => option.textContent?.includes("Texas"));
  expect(texas?.textContent).toContain("Not available in Texas");
  expect(texas?.getAttribute("aria-disabled")).toBe("true");
  await act(async () => texas?.click());
  expect(onFieldChange).not.toHaveBeenCalled();
});

it.each([
  {
    viewport: 1280,
    frameLeft: 460,
    frameWidth: 360,
    border: 1,
    triggerLeft: 617,
    popupLeft: 523,
  },
  {
    viewport: 390,
    frameLeft: 0,
    frameWidth: 390,
    border: 0,
    triggerLeft: 170,
    popupLeft: 94,
  },
])(
  "keeps the state popup inside the $viewport px wallet content column",
  async ({
    viewport,
    frameLeft,
    frameWidth,
    border,
    triggerLeft,
    popupLeft,
  }) => {
    let popupHeight = 320;
    const rect = (element: HTMLElement) => {
      if (element.classList.contains("uds-frame"))
        return new DOMRect(frameLeft, 100, frameWidth, 740);
      if (element.classList.contains("uds-state-picker__trigger"))
        return new DOMRect(triggerLeft, 482, 90, 48);
      if (
        element.classList.contains("uds-state-picker__positioner") ||
        element.classList.contains("uds-state-picker__popup")
      )
        return new DOMRect(0, 0, 280, popupHeight);
      if (element === document.documentElement || element === document.body)
        return new DOMRect(0, 0, viewport, 900);
      return new DOMRect();
    };
    vi.stubGlobal("innerWidth", viewport);
    vi.stubGlobal("innerHeight", 900);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return rect(this);
      },
    );
    for (const [property, dimension] of [
      ["offsetWidth", "width"],
      ["offsetHeight", "height"],
      ["clientWidth", "width"],
      ["clientHeight", "height"],
    ] as const) {
      vi.spyOn(HTMLElement.prototype, property, "get").mockImplementation(
        function (this: HTMLElement) {
          return (
            rect(this)[dimension] -
            (property.startsWith("client") &&
            this.classList.contains("uds-frame")
              ? 2 * border
              : 0)
          );
        },
      );
    }
    for (const property of ["clientLeft", "clientTop"] as const) {
      vi.spyOn(HTMLElement.prototype, property, "get").mockImplementation(
        function (this: HTMLElement) {
          return this.classList.contains("uds-frame") ? border : 0;
        },
      );
    }
    await act(async () =>
      root.render(
        <WalletSheet.Root>
          <WalletSheet.DepositKyc
            values={values}
            blockedStates={{ TX: "Not available in Texas" }}
            onFieldChange={() => {}}
            onSubmit={() => {}}
          />
        </WalletSheet.Root>,
      ),
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[role="combobox"]')?.click(),
    );
    const positioner = document.body.querySelector<HTMLElement>(
      ".uds-state-picker__positioner",
    );
    expect(positioner).not.toBeNull();
    await vi.waitFor(() =>
      expect(positioner?.style.transform).toContain(
        `translate(${popupLeft}px,`,
      ),
    );

    const search = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="Search states"]',
    );
    expect(search).not.toBeNull();
    popupHeight = 122;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(search, "Texas");
      search?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const options = document.body.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("Not available in Texas");
    expect(options[0].getAttribute("aria-disabled")).toBe("true");
    await vi.waitFor(() =>
      expect(positioner?.style.transform).toContain(
        `translate(${popupLeft}px,`,
      ),
    );
  },
);
