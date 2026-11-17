// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WalletSheet } from "./WalletSheet";
import type {
  WalletSheetDepositActivityRow,
  WalletSheetDepositBankMethod,
  WalletSheetDepositBankRow,
} from "./DepositBank";

const bankRows: WalletSheetDepositBankRow[] = [
  { label: "Name", value: "Test Holder", copyLabel: "Copy name" },
  { label: "Routing number", value: "000000001", mono: true, copyLabel: "Copy routing number" },
  { label: "Account number", value: "000000002", mono: true, copyLabel: "Copy account number" },
];
const bankMethods: WalletSheetDepositBankMethod[] = [
  { id: "ach", label: "ACH", wait: "1-3 business days", rows: bankRows },
  {
    id: "wire",
    label: "Wire",
    wait: "~2 h",
    rows: [...bankRows, { label: "Bank address", value: "1 Test Street", copyLabel: "Copy bank address" }],
  },
];
const activityRows: WalletSheetDepositActivityRow[] = [
  { id: "a", tone: "pending", title: "On its way", detail: "ACH · 1-3 business days", amount: "$10.00" },
  { id: "b", tone: "done", title: "Added", detail: "Wire · Nov 9", amount: "+$25.00" },
  { id: "c", tone: "failed", title: "Returned", detail: "ACH · R01", amount: "$5.00" },
];

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
  Reflect.deleteProperty(navigator, "clipboard");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const renderBank = (props: Partial<React.ComponentProps<typeof WalletSheet.DepositBankDetails>> = {}) =>
  act(async () =>
    root.render(
      <WalletSheet.DepositBankDetails methods={bankMethods} onDone={() => {}} onHistory={() => {}} {...props} />,
    ),
  );
const clickCopy = (label: string) =>
  act(async () => {
    container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click();
    await new Promise((resolve) => setTimeout(resolve));
  });
const buttonNamed = (name: string) =>
  Array.from(container.querySelectorAll("button")).find((button) => button.textContent === name);

it("lists the first method's details with a copy button each, its wait and the actions", async () => {
  const onDone = vi.fn();
  const onHistory = vi.fn();
  const onTest = vi.fn();
  await renderBank({
    onDone,
    onHistory,
    testAction: { label: "Simulate a deposit", onClick: onTest },
  });
  const rows = Array.from(container.querySelectorAll(".uds-dep__list [role=listitem]"));
  expect(rows.map((row) => row.textContent)).toEqual([
    "NameTest Holder",
    "Routing number000000001",
    "Account number000000002",
  ]);
  expect(rows.map((row) => row.querySelector("button")?.getAttribute("aria-label"))).toEqual(
    bankRows.map((row) => row.copyLabel),
  );
  // The label takes the secondary, wrapping text style, not the receipt's tertiary one.
  expect(Array.from(container.querySelectorAll(".uds-dep__list-sub")).map((text) => text.textContent)).toEqual([
    "Name",
    "Routing number",
    "Account number",
  ]);
  expect(container.querySelector(".uds-dep__receipt-label")).toBeNull();
  expect(Array.from(container.querySelectorAll(".uds-tag")).map((chip) => chip.textContent)).toEqual(["1-3 business days"]);
  for (const [name, handler] of [
    ["Done", onDone],
    ["Deposit history", onHistory],
    ["Simulate a deposit", onTest],
  ] as const) {
    await act(async () => buttonNamed(name)?.click());
    expect(handler).toHaveBeenCalledTimes(1);
  }
});

it("swaps the details and the wait when another method is picked", async () => {
  await renderBank();
  const tabs = Array.from(container.querySelectorAll<HTMLElement>('[role="tablist"][aria-label="Transfer method"] [role="tab"]'));
  expect(tabs.map((tab) => [tab.textContent, tab.getAttribute("aria-selected")])).toEqual([
    ["ACH", "true"],
    ["Wire", "false"],
  ]);
  await act(async () => tabs[1].click());
  expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true"]);
  expect(container.querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
  expect(
    Array.from(container.querySelectorAll(".uds-dep__list [role=listitem]")).map((row) => row.textContent),
  ).toEqual(["NameTest Holder", "Routing number000000001", "Account number000000002", "Bank address1 Test Street"]);
  expect(container.querySelector(".uds-tag")?.textContent).toBe("~2 h");
});

it("leaves the test action out unless one is passed", async () => {
  await renderBank();
  expect(Array.from(container.querySelectorAll(".uds-wsheet__cta")).map((button) => button.textContent)).toEqual([
    "Done",
    "Deposit history",
  ]);
});

it("copies the row's value and announces it in the one status line", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  await renderBank();
  const status = container.querySelectorAll('[role="status"]');
  expect(status).toHaveLength(1);
  expect(status[0].textContent).toBe("");
  await clickCopy("Copy routing number");
  expect(writeText).toHaveBeenCalledWith("000000001");
  expect(status[0].textContent).toBe("Routing number copied");
  await clickCopy("Copy name");
  expect(writeText).toHaveBeenLastCalledWith("Test Holder");
  expect(status[0].textContent).toBe("Name copied");
});

it("announces nothing when the copy fails", async () => {
  await renderBank();
  await clickCopy("Copy routing number");
  expect(container.querySelector('[role="status"]')?.textContent).toBe("");
});

it("shows a deposit per row with its tone, outside any live region", async () => {
  const onBankDetails = vi.fn();
  await act(async () =>
    root.render(<WalletSheet.DepositActivity rows={activityRows} onBankDetails={onBankDetails} />),
  );
  const rows = Array.from(container.querySelectorAll(".uds-dep__list [role=listitem]"));
  expect(rows.map((row) => row.textContent)).toEqual([
    "On its wayACH · 1-3 business days$10.00",
    "AddedWire · Nov 9+$25.00",
    "ReturnedACH · R01$5.00",
  ]);
  // Each tone draws its own mark, and only the returned deposit's amount is toned down.
  expect(new Set(rows.map((row) => row.firstElementChild?.innerHTML)).size).toBe(3);
  expect(rows.map((row) => row.querySelector(".uds-dep__activity-amount--failed") !== null)).toEqual([
    false,
    false,
    true,
  ]);
  expect(container.querySelector('[aria-live], [role="status"], [role="alert"], [aria-busy]')).toBeNull();
  expect(container.textContent).not.toContain("No deposits yet");
  // DepositScreens.css keeps this outline button at the flow's 13px label on phones.
  expect(buttonNamed("Show bank details")?.matches(".uds-dep__activity .uds-wsheet__cta")).toBe(true);
  await act(async () => buttonNamed("Show bank details")?.click());
  expect(onBankDetails).toHaveBeenCalledTimes(1);
});

it("shows placeholders while the first load runs, then the empty line", async () => {
  await act(async () => root.render(<WalletSheet.DepositActivity rows={[]} loading onBankDetails={() => {}} />));
  expect(container.querySelector(".uds-dep__list")?.getAttribute("aria-busy")).toBe("true");
  expect(container.querySelectorAll(".uds-skeleton").length).toBeGreaterThan(0);
  expect(container.textContent).not.toContain("No deposits yet");

  await act(async () => root.render(<WalletSheet.DepositActivity rows={[]} onBankDetails={() => {}} />));
  expect(container.querySelector(".uds-dep__list")).toBeNull();
  expect(container.textContent).toContain("No deposits yet");
});

it("keeps the rows on screen during a reload", async () => {
  await act(async () =>
    root.render(<WalletSheet.DepositActivity rows={activityRows} loading onBankDetails={() => {}} />),
  );
  expect(container.querySelectorAll(".uds-dep__list [role=listitem]")).toHaveLength(3);
  expect(container.querySelector(".uds-skeleton")).toBeNull();
});

it("shows a step's trailing detail, holds the verified button while disabled, then announces the change", async () => {
  const onDone = vi.fn();
  const render = (disabled: boolean) =>
    act(async () =>
      root.render(
        <WalletSheet.DepositVerified
          items={[
            { label: "Identity verified", status: "done" },
            { label: "Bank details", status: disabled ? "active" : "done", detail: disabled ? "Creating" : undefined },
          ]}
          doneLabel="Show bank details"
          disabled={disabled}
          announce={disabled ? undefined : "Bank details ready"}
          onDone={onDone}
        />,
      ),
    );
  await render(true);
  const status = container.querySelector('[role="status"]');
  expect(status?.textContent).toBe("");
  expect(container.querySelector('[aria-current="step"]')?.textContent).toBe("Bank detailsCreating");
  expect(container.querySelectorAll(".uds-steps__detail")).toHaveLength(1);
  expect(buttonNamed("Show bank details")?.disabled).toBe(true);
  await act(async () => buttonNamed("Show bank details")?.click());
  expect(onDone).not.toHaveBeenCalled();

  await render(false);
  // The same node, so a screen reader hears the new text.
  expect(container.querySelector('[role="status"]')).toBe(status);
  expect(status?.textContent).toBe("Bank details ready");
  expect(container.querySelector(".uds-steps__detail")).toBeNull();
  expect(buttonNamed("Show bank details")?.disabled).toBe(false);
  await act(async () => buttonNamed("Show bank details")?.click());
  expect(onDone).toHaveBeenCalledTimes(1);
});
