// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WalletSheet } from "./WalletSheet";
import type {
  WalletSheetDepositKycProps,
  WalletSheetDepositKycSection,
} from "./DepositKyc";

const countries = ["US", "MX"];
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
  ])
    expect(container.textContent).toContain(label);
  expect(
    container.querySelectorAll("input:not([aria-hidden=true]), select"),
  ).toHaveLength(12);
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
  >("input, button, select"))
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
it("focuses the month when the date of birth is the first error", async () => {
  await act(async () =>
    root.render(
      <WalletSheet.DepositKyc
        section="identity"
        values={{ ...values, dob: "7//" }}
        errors={{ dob: "Enter the month, day and year" }}
        errorAttempt={1}
        onFieldChange={() => {}}
        onSubmit={() => {}}
      />,
    ),
  );
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Month");
  expect(
    drawnControls()
      .filter((control) => control.getAttribute("aria-invalid") === "true")
      .map(controlLabel),
  ).toEqual(["Month", "Day", "Year"]);
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

const sections: WalletSheetDepositKycSection[] = [
  "details",
  "address",
  "identity",
];
const sectionFields = {
  details: ["First name", "Last name", "Email", "Phone"],
  address: ["Street", "Apt, suite (optional)", "City", "State", "ZIP"],
  identity: ["SSN", "Month", "Day", "Year"],
};

function controlLabel(control: HTMLElement) {
  const labelledBy = control.getAttribute("aria-labelledby");
  return (
    control.getAttribute("aria-label") ??
    (labelledBy
      ? document.getElementById(labelledBy)?.textContent
      : container.querySelector(`label[for="${control.id}"]`)?.textContent)
  );
}

function drawnControls() {
  return Array.from(
    container.querySelectorAll<
      HTMLInputElement | HTMLButtonElement | HTMLSelectElement
    >('input:not([aria-hidden="true"]), [role="combobox"], select'),
  );
}

describe.each([
  {
    name: "US without a country list",
    country: undefined,
    fields: sectionFields,
  },
  {
    name: "US with a country list",
    country: "US",
    fields: {
      ...sectionFields,
      details: ["Country", ...sectionFields.details],
    },
  },
  {
    name: "international",
    country: "MX",
    fields: {
      details: ["Country", ...sectionFields.details],
      address: [
        "Street",
        "Apt, suite (optional)",
        "City",
        "Region",
        "Postcode",
      ],
      identity: ["ID type", "ID number", "Month", "Day", "Year"],
    },
  },
])("$name", ({ country, fields }) => {
  it.each(sections)(
    "renders only the %s section with its defaults",
    async (section) => {
      const countryProps = country
        ? { countries, values: { ...values, country } }
        : { values };
      await act(async () =>
        root.render(
          <WalletSheet.DepositKyc
            {...countryProps}
            section={section}
            onFieldChange={() => {}}
            onSubmit={() => {}}
          />,
        ),
      );

      const controls = drawnControls();
      expect(controls.map(controlLabel)).toEqual(fields[section]);
      expect(container.querySelector(".tds-dep__rail-title")?.textContent).toBe(
        {
          details: "Your details",
          address: "Home address",
          identity: "Your identity",
        }[section],
      );

      const nonUs = country === "MX";
      const details = section === "details";
      const identity = section === "identity";
      const description = container.querySelector(".tds-dep__rail-sub");
      expect(description?.textContent).toBe(
        details && country === undefined
          ? "US residents only for now."
          : undefined,
      );
      expect(
        container.textContent?.includes("Deposits need a US bank for now."),
      ).toBe(details && nonUs);
      if (details) {
        const phone = controls.find(
          (control) => controlLabel(control) === "Phone",
        );
        expect(phone?.getAttribute("autocomplete")).toBe(
          nonUs ? "tel" : "tel-national",
        );
      }

      const verify = identity && !nonUs;
      const button = container.querySelector('button[type="submit"]');
      expect(button?.textContent).toBe(
        verify ? "Verify with passkey" : "Continue",
      );
      expect(button?.querySelectorAll("svg")).toHaveLength(verify ? 1 : 0);
      expect(container.textContent).not.toContain("banking partner");
      if (identity) {
        const legendId = container
          .querySelector("fieldset")
          ?.getAttribute("aria-labelledby");
        expect(legendId && document.getElementById(legendId)?.textContent).toBe(
          "Date of birth",
        );
        expect(
          controls
            .filter((control) => control.closest("fieldset"))
            .map((control) => control.getAttribute("placeholder")),
        ).toEqual([null, "Day", "Year"]);
      }

      if (section === "address") {
        const legend = container.querySelector("fieldset legend");
        expect(legend?.textContent).toBe("Home address");
        expect(legend?.classList.contains("tds-dep__kyc-legend--hidden")).toBe(
          true,
        );
        if (nonUs) {
          const region = controls.find(
            (control) => controlLabel(control) === "Region",
          );
          const postcode = controls.find(
            (control) => controlLabel(control) === "Postcode",
          );
          expect(region?.getAttribute("placeholder")).toBe("Optional");
          expect(postcode?.getAttribute("inputmode")).toBeNull();
        }
      }
    },
  );
});

it.each([
  ["details", { country: "Choose a country" }, ["Country"]],
  [
    "address",
    { region: "Invalid region", postcode: "Invalid postcode" },
    ["Region", "Postcode"],
  ],
  [
    "identity",
    { idType: "Choose an ID type", idNumber: "Invalid ID number" },
    ["ID type", "ID number"],
  ],
] as const)(
  "shows and focuses international errors in %s",
  async (section, errors, labels) => {
    await act(async () =>
      root.render(
        <WalletSheet.DepositKyc
          section={section}
          countries={countries}
          values={{ ...values, country: "MX" }}
          errors={errors}
          errorAttempt={1}
          onFieldChange={() => {}}
          onSubmit={() => {}}
        />,
      ),
    );
    const invalid = drawnControls().filter(
      (control) => control.getAttribute("aria-invalid") === "true",
    );
    expect(invalid.map(controlLabel)).toEqual(labels);
    expect(
      invalid.map((control) => {
        const id = control.getAttribute("aria-describedby") ?? "";
        return document.getElementById(id)?.textContent;
      }),
    ).toEqual(Object.values(errors));
    expect(document.activeElement).toBe(invalid[0]);
  },
);

it("uses the selected ID type and lets the caller override the identity action", async () => {
  const onFieldChange = vi.fn();
  function Example() {
    const [idType, setIdType] = React.useState<"PASSPORT" | null>(null);
    return (
      <WalletSheet.DepositKyc
        section="identity"
        countries={countries}
        values={{ ...values, country: "MX", idType }}
        identitySubmit="verify"
        onFieldChange={(field, value) => {
          onFieldChange(field, value);
          if (field === "idType" && value === "PASSPORT") setIdType(value);
        }}
        onSubmit={() => {}}
      />
    );
  }
  await act(async () => root.render(<Example />));
  const picker = container.querySelector("select");
  expect(picker).not.toBeNull();
  expect(
    Array.from(picker?.options ?? [])
      .filter((option) => !option.disabled)
      .map((option) => option.text),
  ).toEqual([
    "Passport",
    "National ID",
    "Voter ID",
    "Resident ID",
    "Driver’s license",
  ]);
  await act(async () => {
    if (!picker) return;
    picker.value = "PASSPORT";
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onFieldChange).toHaveBeenCalledExactlyOnceWith("idType", "PASSPORT");
  const passport = drawnControls().find(
    (control) => controlLabel(control) === "Passport number",
  );
  expect(passport?.getAttribute("inputmode")).toBe("text");
  expect(passport?.getAttribute("placeholder")).toBe("ID number");
  expect(passport?.getAttribute("maxlength")).toBe("64");
  expect(passport?.hasAttribute("data-masked")).toBe(true);
  expect(container.querySelector('button[type="submit"]')?.textContent).toBe(
    "Verify with passkey",
  );
});

it("renders the supplied ID types in order", async () => {
  await act(async () =>
    root.render(
      <WalletSheet.DepositKyc
        section="identity"
        countries={["US", "GH", "NG", "CO"]}
        values={{ ...values, country: "GH" }}
        idTypes={[
          "GHANA_CARD_NUMBER",
          "SSNIT",
          "NIN",
          "COLOMBIA_PPT",
          "PASSPORT",
        ]}
        onFieldChange={() => {}}
        onSubmit={() => {}}
      />,
    ),
  );
  expect(
    Array.from(
      container.querySelectorAll(
        'select:not([aria-label="Month"]) option:not(:disabled)',
      ),
    ).map((option) => option.textContent),
  ).toEqual(["Ghana Card", "SSNIT card", "NIN", "PPT", "Passport"]);
});

it("uses the ID number label, placeholder and keyboard overrides", async () => {
  await act(async () =>
    root.render(
      <WalletSheet.DepositKyc
        section="identity"
        countries={["US", "NG"]}
        values={{ ...values, country: "NG", idType: "NIN" }}
        idTypes={["NIN"]}
        idNumber={{
          label: "NIN number",
          placeholder: "12345678901",
          inputMode: "numeric",
        }}
        onFieldChange={() => {}}
        onSubmit={() => {}}
      />,
    ),
  );
  const input = drawnControls().find(
    (control) => controlLabel(control) === "NIN number",
  );
  expect(input).toMatchObject({
    placeholder: "12345678901",
    inputMode: "numeric",
  });
});

it("selects a country and keeps the new identity field masked", async () => {
  const onFieldChange = vi.fn();
  function Example() {
    const [country, setCountry] = React.useState<string>();
    return (
      <WalletSheet.DepositKyc
        countries={countries}
        values={{ ...values, country }}
        onFieldChange={(field, value) => {
          onFieldChange(field, value);
          if (field === "country" && typeof value === "string")
            setCountry(value);
        }}
        onSubmit={() => {}}
      />
    );
  }
  await act(async () => root.render(<Example />));
  const country = drawnControls().find(
    (control) => controlLabel(control) === "Country",
  );
  expect(country?.textContent).toBe("United States");
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Show number"]')
      ?.click(),
  );
  expect(
    container.querySelector('button[aria-label="Hide number"]'),
  ).not.toBeNull();
  await act(async () => country?.click());
  const mexico = document.body.querySelector<HTMLElement>(
    '[role="option"][aria-label="Mexico"]',
  );
  expect(mexico).not.toBeNull();
  await act(async () => mexico?.click());
  expect(onFieldChange).toHaveBeenCalledExactlyOnceWith("country", "MX");
  expect(country?.textContent).toBe("Mexico");
  const idNumber = drawnControls().find(
    (control) => controlLabel(control) === "ID number",
  );
  expect(idNumber?.hasAttribute("data-masked")).toBe(true);
  expect(
    container.querySelector('button[aria-label="Show number"]'),
  ).not.toBeNull();
});

it.each(sections)(
  "focuses a drawn error on each attempt in %s",
  async (section) => {
    const errors = {
      firstName: "Required",
      zip: "Invalid ZIP",
      ssn: "Invalid SSN",
    };
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
    const invalid = container.querySelector<HTMLElement>(
      '[aria-invalid="true"]',
    );
    expect(invalid).not.toBeNull();
    expect(document.activeElement).not.toBe(invalid);
    for (const attempt of [1, 2]) {
      invalid?.blur();
      await act(async () => root.render(render(attempt)));
      expect(document.activeElement).toBe(invalid);
    }
  },
);

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
  expect(container.querySelector(".tds-dep__rail-title")?.textContent).toBe(
    "Custom title",
  );
  expect(container.querySelector(".tds-dep__rail-sub")?.textContent).toBe(
    "Custom description",
  );
  expect(container.querySelector('button[type="submit"]')?.textContent).toBe(
    "Custom submit",
  );
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
  for (const control of container.querySelectorAll<
    HTMLInputElement | HTMLButtonElement
  >("input, button")) {
    expect(control.disabled).toBe(true);
  }
  const button = container.querySelector('button[type="submit"]');
  expect(button?.getAttribute("aria-busy")).toBe("true");
  expect(button?.querySelector(".tds-spinner")).not.toBeNull();
  expect(button?.querySelector(".tds-passkey-icon")).toBeNull();
  expect(container.querySelector(".tds-dep__note")?.textContent).toBe(
    "Submitting details",
  );
  await act(async () =>
    container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(onSubmit).not.toHaveBeenCalled();
});
