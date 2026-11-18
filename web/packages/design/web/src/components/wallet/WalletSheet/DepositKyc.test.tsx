// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WalletSheet } from "./WalletSheet";
import type {
  WalletSheetDepositKycProps,
  WalletSheetDepositKycSection,
} from "./DepositKyc";

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
    "SSN and date of birth go only to our banking partner.",
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
      if (element.classList.contains("tds-frame"))
        return new DOMRect(frameLeft, 100, frameWidth, 740);
      if (element.classList.contains("tds-state-picker__trigger"))
        return new DOMRect(triggerLeft, 482, 90, 48);
      if (
        element.classList.contains("tds-state-picker__positioner") ||
        element.classList.contains("tds-state-picker__popup")
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
            this.classList.contains("tds-frame")
              ? 2 * border
              : 0)
          );
        },
      );
    }
    for (const property of ["clientLeft", "clientTop"] as const) {
      vi.spyOn(HTMLElement.prototype, property, "get").mockImplementation(
        function (this: HTMLElement) {
          return this.classList.contains("tds-frame") ? border : 0;
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
      ".tds-state-picker__positioner",
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

const sections: WalletSheetDepositKycSection[] = ["details", "address", "identity"];
const sectionFields = {
  details: ["First name", "Last name", "Email", "Phone"],
  address: ["Street", "Apt, suite (optional)", "City", "State", "ZIP"],
  identity: ["SSN", "Date of birth"],
};

it.each(sections)("renders only the %s section with its defaults", async (section) => {
  await act(async () =>
    root.render(
      <WalletSheet.DepositKyc
        section={section}
        values={values}
        onFieldChange={() => {}}
        onSubmit={() => {}}
      />,
    ),
  );
  const controls = Array.from(
    container.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
      'input:not([aria-hidden="true"]), [role="combobox"]',
    ),
  );
  const labels = controls.map((control) => {
    const labelledBy = control.getAttribute("aria-labelledby");
    return control.getAttribute("aria-label") ?? (
      labelledBy
        ? document.getElementById(labelledBy)?.textContent
        : container.querySelector(`label[for="${control.id}"]`)?.textContent
    );
  });
  for (const group of sections) {
    for (const field of sectionFields[group]) {
      expect(labels.includes(field)).toBe(group === section);
    }
  }
  expect(controls).toHaveLength(sectionFields[section].length);
  expect(container.querySelector(".tds-dep__rail-title")?.textContent).toBe({
    details: "Your details",
    address: "Home address",
    identity: "Your identity",
  }[section]);
  const description = container.querySelector(".tds-dep__rail-sub");
  if (section === "details") {
    expect(description?.textContent).toBe("US residents only for now.");
  } else {
    expect(description).toBeNull();
  }
  const identity = section === "identity";
  const note = container.querySelector(".tds-dep__kyc-note");
  if (identity) {
    expect(note?.textContent).toBe("SSN and date of birth go only to our banking partner.");
    expect(note?.querySelector("svg")).not.toBeNull();
  } else {
    expect(note).toBeNull();
  }
  const button = container.querySelector('button[type="submit"]');
  expect(button?.textContent).toBe(identity ? "Verify with passkey" : "Continue");
  expect(button?.querySelector(".tds-passkey-icon") !== null).toBe(identity);
  expect(button?.querySelectorAll("svg")).toHaveLength(identity ? 1 : 0);
  if (section === "address") {
    const legend = container.querySelector("fieldset legend");
    expect(legend?.textContent).toBe("Home address");
    expect(legend?.classList.contains("tds-dep__kyc-legend--hidden")).toBe(true);
  }
});

it.each(sections)("focuses a drawn error on each attempt in %s", async (section) => {
  const errors = { firstName: "Required", zip: "Invalid ZIP", ssn: "Invalid SSN" };
  const render = (errorAttempt: number) => (
    <WalletSheet.DepositKyc
      section={section}
      values={values}
      errors={errors}
      errorAttempt={errorAttempt}
      onFieldChange={() => {}}
      onSubmit={() => {}}
    />
  );
  await act(async () => root.render(render(0)));
  const invalid = container.querySelector<HTMLElement>('[aria-invalid="true"]');
  expect(invalid).not.toBeNull();
  expect(document.activeElement).not.toBe(invalid);
  for (const attempt of [1, 2]) {
    invalid?.blur();
    await act(async () => root.render(render(attempt)));
    expect(document.activeElement).toBe(invalid);
  }
});

it.each(sections)("uses explicit copy in %s", async (section) => {
  await act(async () =>
    root.render(
      <WalletSheet.DepositKyc
        section={section}
        title="Custom title"
        description="Custom description"
        submitLabel="Custom submit"
        values={values}
        onFieldChange={() => {}}
        onSubmit={() => {}}
      />,
    ),
  );
  expect(container.querySelector(".tds-dep__rail-title")?.textContent).toBe("Custom title");
  expect(container.querySelector(".tds-dep__rail-sub")?.textContent).toBe("Custom description");
  expect(container.querySelector('button[type="submit"]')?.textContent).toBe("Custom submit");
});

it("locks the identity section and replaces its icon while submitting", async () => {
  const onSubmit = vi.fn();
  await act(async () =>
    root.render(
      <WalletSheet.DepositKyc
        section="identity"
        values={values}
        disabled
        submitting
        status="Submitting details"
        notice="Fallback notice"
        onFieldChange={() => {}}
        onSubmit={onSubmit}
      />,
    ),
  );
  for (const control of container.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")) {
    expect(control.disabled).toBe(true);
  }
  const button = container.querySelector('button[type="submit"]');
  expect(button?.getAttribute("aria-busy")).toBe("true");
  expect(button?.querySelector(".tds-spinner")).not.toBeNull();
  expect(button?.querySelector(".tds-passkey-icon")).toBeNull();
  expect(container.querySelector(".tds-dep__note")?.textContent).toBe("Submitting details");
  await act(async () =>
    container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(onSubmit).not.toHaveBeenCalled();
});
