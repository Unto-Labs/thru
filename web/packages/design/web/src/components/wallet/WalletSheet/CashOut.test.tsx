// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WalletSheet } from "./WalletSheet";
import type {
  WalletSheetCashOutAmountProps,
  WalletSheetCashOutBank,
  WalletSheetCashOutBankProps,
  WalletSheetCashOutProps,
  WalletSheetCashOutReviewProps,
  WalletSheetCashOutSpeed,
  WalletSheetCashOutStatusProps,
} from "./CashOut";

const banks: WalletSheetCashOutBank[] = [
  { id: "b1", title: "Checking", detail: "····1234", detailLabel: "ending in" },
  { id: "b2", title: "Savings", detail: "····9876", detailLabel: "ending in" },
];
const speeds: WalletSheetCashOutSpeed[] = [
  { id: "same_day_ach", title: "Same-day ACH", detail: "Today" },
  { id: "ach", title: "ACH", detail: "1-3 business days" },
];
const bankValues: WalletSheetCashOutBankProps["values"] = {
  owner: "",
  routing_number: "",
  account_number: "",
  account_number_confirm: "",
  account_type: "checking",
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

const render = (node: React.ReactNode) => act(async () => root.render(node));
const buttonNamed = (name: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === name);
const click = (element: Element | null | undefined) => act(async () => (element as HTMLElement).click());
const radios = () => Array.from(container.querySelectorAll<HTMLElement>('[role="radio"]'));
const press = (element: Element, key: string) =>
  act(async () => {
    (element as HTMLElement).focus();
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
const field = (label: string) =>
  container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`) ??
  (Array.from(container.querySelectorAll("label")).find((node) => node.textContent === label)?.control as HTMLInputElement);
const type = (input: HTMLInputElement, text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const groupName = () =>
  document.getElementById(container.querySelector('[role="radiogroup"]')?.getAttribute("aria-labelledby") ?? "")?.textContent;

const renderCashOut = (props: Partial<WalletSheetCashOutProps> = {}) =>
  render(
    <WalletSheet.CashOut banks={banks} onBankChange={() => {}} onAddBank={() => {}} onContinue={() => {}} {...props} />,
  );

it("lists the banks as a radio group named To, with the hidden label before each detail", async () => {
  const onBankChange = vi.fn();
  const onAddBank = vi.fn();
  const onContinue = vi.fn();
  await renderCashOut({ balance: "$120.00", bankId: "b1", onBankChange, onAddBank, onContinue });
  expect(container.querySelector(".tds-screen__header")?.textContent).toBe("Cash out$120.00Available");
  expect(groupName()).toBe("To");
  expect(radios().map((radio) => radio.getAttribute("aria-checked"))).toEqual(["true", "false"]);
  const rows = Array.from(container.querySelectorAll(".tds-cashout__choice"));
  expect(rows.map((row) => row.textContent)).toEqual(["Checking····ending in 1234", "Savings····ending in 9876"]);
  expect(rows[0].querySelector(".tds-dep__sr-status")?.textContent).toBe("ending in ");
  expect(rows[0].querySelector(".tds-dep__sr-status")?.previousElementSibling?.outerHTML).toBe(
    '<span aria-hidden="true">····</span>',
  );
  // Each radio is named by its row.
  expect(rows.map((row) => row.contains(row.querySelector('[role="radio"]')) && row.tagName)).toEqual(["LABEL", "LABEL"]);
  expect(container.textContent).toContain("US bank accounts only.");

  await click(rows[1]);
  expect(onBankChange).toHaveBeenLastCalledWith("b2");
  await click(buttonNamed("Add a US bank"));
  expect(onAddBank).toHaveBeenCalledTimes(1);
  expect(buttonNamed("Continue")?.disabled).toBe(false);
  await click(buttonNamed("Continue"));
  expect(onContinue).toHaveBeenCalledTimes(1);
});

it("moves the bank choice with the arrow keys", async () => {
  const onBankChange = vi.fn();
  await renderCashOut({ bankId: "b1", onBankChange });
  expect(radios().map((radio) => radio.tabIndex)).toEqual([0, -1]);
  await press(radios()[0], "ArrowDown");
  expect(onBankChange).toHaveBeenLastCalledWith("b2");
});

it("leaves the balance out when it is not known and holds Continue until a bank is chosen", async () => {
  const onContinue = vi.fn();
  await renderCashOut({ onContinue });
  expect(container.querySelector(".tds-screen__header")?.textContent).toBe("Cash out");
  expect(container.textContent).not.toContain("Available");
  expect(radios().map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "false"]);
  expect(buttonNamed("Continue")?.disabled).toBe(true);
  await click(buttonNamed("Continue"));
  expect(onContinue).not.toHaveBeenCalled();

  await renderCashOut({ bankId: "gone", onContinue });
  expect(buttonNamed("Continue")?.disabled).toBe(true);
});

it("shows a placeholder while the banks load, and only the add row when there are none", async () => {
  await renderCashOut({ banks: [], loading: true });
  expect(container.querySelector('[aria-busy="true"] .tds-skeleton')).not.toBeNull();
  expect(container.querySelector('[role="radiogroup"]')).toBeNull();
  expect(buttonNamed("Continue")?.disabled).toBe(true);

  await renderCashOut({ banks: [] });
  expect(container.querySelector("[aria-busy], .tds-skeleton, [role=radiogroup]")).toBeNull();
  expect(buttonNamed("Add a US bank")).toBeDefined();

  await renderCashOut({ loading: true });
  expect(radios()).toHaveLength(2);
  expect(container.querySelector(".tds-skeleton")).toBeNull();
});

const renderBank = (props: Partial<WalletSheetCashOutBankProps> = {}) =>
  render(<WalletSheet.CashOutBank values={bankValues} onFieldChange={() => {}} onSubmit={() => {}} {...props} />);

it("collects the bank's details, digits only for the numbers, and masks the account number", async () => {
  const onFieldChange = vi.fn();
  const onSubmit = vi.fn();
  await renderBank({ onFieldChange, onSubmit });
  expect(container.textContent).toContain("US bank account");
  expect(container.textContent).toContain("Only the format is checked. Wrong numbers bounce back.");
  expect(container.querySelector("[name], [action], [method]")).toBeNull();

  await type(field("Name on account"), "Test Holder");
  expect(onFieldChange).toHaveBeenLastCalledWith("owner", "Test Holder");

  const routing = field("Routing number");
  expect([routing.inputMode, routing.maxLength, routing.placeholder, routing.autocomplete]).toEqual(["numeric", -1, "9 digits", "off"]);
  await type(routing, "0210-0002a");
  expect(onFieldChange).toHaveBeenLastCalledWith("routing_number", "02100002");
  await type(routing, "021 000 021");
  expect(onFieldChange).toHaveBeenLastCalledWith("routing_number", "021000021");
  await type(routing, "021 000 021 7");
  expect(onFieldChange).toHaveBeenLastCalledWith("routing_number", "021000021");

  const account = field("Account number");
  expect([account.type, account.getAttribute("data-masked"), account.autocomplete]).toEqual(["text", "true", "off"]);
  await type(account, "12 34-56");
  expect(onFieldChange).toHaveBeenLastCalledWith("account_number", "123456");

  const confirm = field("Confirm account number");
  expect([confirm.hasAttribute("data-masked"), confirm.autocomplete, confirm.getAttribute("data-1p-ignore")]).toEqual([false, "off", "true"]);
  await type(confirm, `9-${"1".repeat(20)}`);
  expect(onFieldChange).toHaveBeenLastCalledWith("account_number_confirm", `9${"1".repeat(16)}`);

  const event = new Event("submit", { bubbles: true, cancelable: true });
  await act(async () => container.querySelector("form")?.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(buttonNamed("Save bank")?.type).toBe("submit");
});

it("switches the account type and never clears it", async () => {
  const onFieldChange = vi.fn();
  await renderBank({ onFieldChange });
  const group = container.querySelector(".tds-cashout__type");
  expect(document.getElementById(group?.getAttribute("aria-labelledby") ?? "")?.textContent).toBe("Account type");
  expect([buttonNamed("Checking"), buttonNamed("Savings")].map((button) => button?.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
  await click(buttonNamed("Checking"));
  expect(onFieldChange).not.toHaveBeenCalled();
  await click(buttonNamed("Savings"));
  expect(onFieldChange).toHaveBeenCalledWith("account_type", "savings");
});

it("shows each field's error and focuses the first invalid field on every refused submit", async () => {
  const errors = { routing_number: "Check the routing number.", account_number_confirm: "Numbers don’t match." };
  await renderBank({ errors, errorAttempt: 1 });
  const invalid = Array.from(container.querySelectorAll<HTMLInputElement>('[aria-invalid="true"]'));
  expect(invalid).toEqual([field("Routing number"), field("Confirm account number")]);
  for (const [input, message] of [
    [invalid[0], errors.routing_number],
    [invalid[1], errors.account_number_confirm],
  ] as const) {
    expect(document.getElementById(input.getAttribute("aria-describedby") ?? "")?.textContent).toBe(message);
  }
  expect(document.activeElement).toBe(invalid[0]);

  invalid[1].focus();
  await renderBank({ errors, errorAttempt: 2 });
  expect(document.activeElement).toBe(invalid[0]);

  await renderBank({ errors: { account_number: "Enter 4 to 17 digits", account_type: "Pick one." }, errorAttempt: 3 });
  expect(document.activeElement).toBe(field("Account number"));
  expect(container.querySelector(".tds-cashout__error")?.textContent).toBe("Pick one.");
});

it("holds the save while submitting and shows the notice in a status line", async () => {
  const onSubmit = vi.fn();
  await renderBank({ submitting: true, notice: "Couldn’t save the bank. Try again.", onSubmit });
  const save = container.querySelector<HTMLButtonElement>('button[type="submit"]');
  expect([save?.disabled, save?.getAttribute("aria-busy"), save?.textContent]).toEqual([true, "true", "Save bank"]);
  expect(save?.querySelector(".tds-spinner")).not.toBeNull();
  await act(async () => container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(onSubmit).not.toHaveBeenCalled();
  expect(container.querySelector('form [role="status"]:not(.tds-spinner)')?.textContent).toBe("Couldn’t save the bank. Try again.");

  await renderBank();
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(buttonNamed("Save bank")?.hasAttribute("aria-busy")).toBe(false);
});

const renderAmount = (props: Partial<WalletSheetCashOutAmountProps> = {}) =>
  render(
    <WalletSheet.CashOutAmount
      amount=""
      onAmountChange={() => {}}
      speeds={speeds}
      speedId="same_day_ach"
      onSpeedChange={() => {}}
      onReview={() => {}}
      {...props}
    />,
  );

it("keeps the amount as typed digits behind a $ and offers Max only when it can", async () => {
  const onAmountChange = vi.fn();
  const onMax = vi.fn();
  await renderAmount({ onAmountChange });
  const amount = field("Amount in dollars");
  expect([amount.value, amount.placeholder, amount.inputMode]).toEqual(["", "$0.00", "decimal"]);
  expect(buttonNamed("Max")).toBeUndefined();
  expect(container.textContent).not.toContain("available");
  for (const [typed, kept] of [
    ["5", "5"],
    ["$12.345", "12.34"],
    ["$1,200.5x", "1200.5"],
    ["$5,50", "5.50"],
    ["$1,234", "1234"],
    ["$1.2.3", "1.2"],
    ["$", ""],
  ]) {
    await type(amount, typed);
    expect(onAmountChange).toHaveBeenLastCalledWith(kept);
  }

  await renderAmount({ amount: "25.5", balance: "$120.00", onMax });
  expect(amount.value).toBe("$25.5");
  expect(container.querySelector(".tds-dep__quote")?.textContent).toBe("$120.00 available");
  await click(buttonNamed("Max"));
  expect(onMax).toHaveBeenCalledTimes(1);
});

function AmountHarness({ outside }: { outside?: string }) {
  const [amount, setAmount] = React.useState("");
  React.useEffect(() => {
    if (outside != null) setAmount(outside);
  }, [outside]);
  return (
    <>
      <WalletSheet.CashOutAmount
        amount={amount}
        onAmountChange={setAmount}
        speeds={speeds}
        speedId="same_day_ach"
        onSpeedChange={() => {}}
        onReview={() => {}}
      />
      <output>{amount}</output>
    </>
  );
}
const typeKeys = async (input: HTMLInputElement, keys: string) => {
  const seen: string[] = [];
  for (const key of keys) {
    await type(input, input.value + key);
    seen.push(input.value);
  }
  return seen;
};

it("keeps a decimal comma as typed and shows every other amount plainly", async () => {
  for (const [keys, shown, kept, passes] of [
    ["1,234", "$1234", "1234", "$1,23"],
    ["5,50", "$5,50", "5.50", "$5,5"],
    ["5,505", "$5505", "5505", "$5,50"],
    ["1,5.", "$15.", "15.", "$1,5"],
    ["1,234.56", "$1234.56", "1234.56", "$1234"],
    ["12.345", "$12.34", "12.34", "$12.3"],
  ]) {
    await render(<AmountHarness key={keys} />);
    const amount = field("Amount in dollars");
    const seen = await typeKeys(amount, keys);
    expect(seen).toContain(passes);
    expect([amount.value, container.querySelector("output")?.textContent]).toEqual([shown, kept]);
  }

  await render(<AmountHarness key="back" />);
  const typed = field("Amount in dollars");
  await typeKeys(typed, "5,50");
  const back: string[] = [];
  for (const text of ["$5,5", "$5,", "$5"]) {
    await type(typed, text);
    back.push(typed.value);
  }
  expect(back).toEqual(["$5,5", "$5,", "$5"]);

  await render(<AmountHarness key="outside" />);
  const amount = field("Amount in dollars");
  await typeKeys(amount, "1,5");
  expect(amount.value).toBe("$1,5");
  await render(<AmountHarness key="outside" outside="120" />);
  expect([amount.value, container.querySelector("output")?.textContent]).toEqual(["$120", "120"]);
});

it("shows the amount's error on the field", async () => {
  await renderAmount({ amount: "500", error: "More than your balance." });
  const amount = field("Amount in dollars");
  expect(amount.getAttribute("aria-invalid")).toBe("true");
  expect(document.getElementById(amount.getAttribute("aria-describedby") ?? "")?.textContent).toBe("More than your balance.");

  await renderAmount({ amount: "5" });
  expect(amount.hasAttribute("aria-invalid")).toBe(false);
  expect(container.textContent).not.toContain("More than your balance.");
});

it("moves focus to the amount when Review is refused", async () => {
  await renderAmount({ amount: "99" });
  buttonNamed("Review")?.focus();
  await renderAmount({ amount: "99", error: "More than your balance." });
  expect(document.activeElement).toBe(field("Amount in dollars"));
});

it("offers the speeds as a radio group named Speed and holds Review while disabled", async () => {
  const onSpeedChange = vi.fn();
  const onReview = vi.fn();
  await renderAmount({ onSpeedChange, onReview, disabled: true });
  expect(groupName()).toBe("Speed");
  expect(Array.from(container.querySelectorAll(".tds-cashout__choice")).map((row) => row.textContent)).toEqual([
    "Same-day ACHToday",
    "ACH1-3 business days",
  ]);
  expect(radios().map((radio) => radio.getAttribute("aria-checked"))).toEqual(["true", "false"]);
  await click(radios()[1]);
  expect(onSpeedChange).toHaveBeenLastCalledWith("ach");
  await press(radios()[0], "ArrowDown");
  expect(onSpeedChange).toHaveBeenCalledTimes(2);
  expect(buttonNamed("Review")?.disabled).toBe(true);
  await click(buttonNamed("Review"));
  expect(onReview).not.toHaveBeenCalled();

  await renderAmount({ onReview });
  await click(buttonNamed("Review"));
  expect(onReview).toHaveBeenCalledTimes(1);
});

const reviewRows = [
  { label: "Speed", value: "Same-day ACH" },
  { label: "Arrives", value: "Today" },
];
const renderReview = (props: Partial<WalletSheetCashOutReviewProps> = {}) =>
  render(
    <WalletSheet.CashOutReview
      amount="$25.00"
      bank={banks[0]}
      rows={reviewRows}
      note="Funds leave your wallet now."
      onConfirm={() => {}}
      {...props}
    />,
  );

it("reviews the amount, the bank and the rows, and confirms with the passkey button", async () => {
  const onConfirm = vi.fn();
  await renderReview({ onConfirm });
  expect(container.querySelector(".tds-screen__header")?.textContent).toBe("Review$25.00to Checking ····ending in 1234");
  expect(Array.from(container.querySelectorAll("dl > div")).map((row) => [row.querySelector("dt")?.textContent, row.querySelector("dd")?.textContent])).toEqual([
    ["Speed", "Same-day ACH"],
    ["Arrives", "Today"],
  ]);
  expect(container.textContent).toContain("Funds leave your wallet now.");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  const confirm = buttonNamed("Confirm with passkey");
  expect(confirm?.querySelector(".tds-passkey-icon")).not.toBeNull();
  await click(confirm);
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

it("draws no bank line without a bank, and the test note when told", async () => {
  await renderReview({ bank: undefined, note: "Test mode. Your balance does not change." });
  expect(container.querySelector(".tds-screen__header")?.textContent).toBe("Review$25.00");
  expect(container.textContent).toContain("Test mode. Your balance does not change.");
});

it("holds the confirm button while submitting and reports an error", async () => {
  const onConfirm = vi.fn();
  await renderReview({ submitting: true, onConfirm });
  const confirm = container.querySelector<HTMLButtonElement>(".tds-wsheet__cta");
  expect([confirm?.disabled, confirm?.getAttribute("aria-busy"), confirm?.textContent]).toEqual([true, "true", "Confirm with passkey"]);
  expect(confirm?.querySelector(".tds-spinner")).not.toBeNull();
  expect(confirm?.querySelector(".tds-passkey-icon")).toBeNull();
  await click(confirm);
  expect(onConfirm).not.toHaveBeenCalled();

  await renderReview({ error: "Couldn’t send the payout. Try again." });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Couldn’t send the payout. Try again.");
  expect(buttonNamed("Confirm with passkey")?.disabled).toBe(false);
});

const renderStatus = (status: WalletSheetCashOutStatusProps["status"], props: Partial<WalletSheetCashOutStatusProps> = {}) =>
  render(<WalletSheet.CashOutStatus status={status} amount="$25.00" bank={banks[0]} arrives="Today" onDone={() => {}} {...props} />);
const steps = () =>
  Array.from(container.querySelectorAll(".tds-steps__row")).map((row) => [
    row.textContent,
    row.className.replace("tds-steps__row tds-steps__row--", ""),
  ]);

it("follows a payout from the wallet to the bank in one status region", async () => {
  const onDone = vi.fn();
  await renderStatus("sending", { onDone });
  const status = container.querySelector('[role="status"]');
  expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  expect(status?.textContent).toBe("Sending");
  expect(container.querySelector(".tds-screen__sub")?.textContent).toBe("$25.00to Checking ····ending in 1234");
  expect(steps()).toEqual([
    ["Sent from wallet", "active"],
    ["Processing", "pending"],
    ["In your bankToday", "pending"],
  ]);
  expect(container.querySelector('[aria-current="step"]')?.textContent).toBe("Sent from wallet");

  await renderStatus("processing", { onDone });
  // The same node, so a screen reader hears the new headline.
  expect(container.querySelector('[role="status"]')).toBe(status);
  expect(status?.textContent).toBe("On its way");
  expect(steps()).toEqual([
    ["Done: Sent from wallet", "done"],
    ["Processing", "active"],
    ["In your bankToday", "pending"],
  ]);
  expect(container.querySelector(".tds-screen__badge--neutral .tds-spinner")).not.toBeNull();

  await renderStatus("sent", { onDone });
  expect(container.querySelector('[role="status"]')).toBe(status);
  expect(status?.textContent).toBe("Sent to your bank");
  expect(steps()).toEqual([
    ["Done: Sent from wallet", "done"],
    ["Done: Processing", "done"],
    ["Done: In your bank", "done"],
  ]);
  expect(container.querySelector(".tds-screen__badge--success")).not.toBeNull();
  expect(container.querySelector("[aria-current]")).toBeNull();
  expect(container.querySelector("a")).toBeNull();
  await click(buttonNamed("Done"));
  expect(onDone).toHaveBeenCalledTimes(1);
});

it("draws no amount, bank line or arrival hint it was not given", async () => {
  await renderStatus("processing", { amount: undefined, bank: undefined, arrives: undefined });
  expect(container.querySelector(".tds-screen__header")?.textContent).toBe("On its way");
  expect(container.querySelector(".tds-screen__sub")).toBeNull();
  expect(container.querySelector(".tds-steps__detail")).toBeNull();
  expect(steps()).toHaveLength(3);

  await renderStatus("processing", { bank: undefined });
  expect(container.querySelector(".tds-screen__sub")?.textContent).toBe("$25.00");
});

it("tells a failed payout apart: support and Done, no steps", async () => {
  const onDone = vi.fn();
  await renderStatus("failed", { onDone, supportHref: "mailto:support@example.com" });
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Payout failedContact support to get your funds back.");
  expect(container.querySelector(".tds-screen__badge--danger")).not.toBeNull();
  expect(container.querySelector(".tds-steps, .tds-screen__sub")).toBeNull();
  expect(container.textContent).not.toContain("$25.00");
  const support = container.querySelector("a");
  expect([support?.textContent, support?.getAttribute("href"), support?.matches(".tds-btn--primary.tds-wsheet__cta")]).toEqual([
    "Contact support",
    "mailto:support@example.com",
    true,
  ]);
  expect(buttonNamed("Done")?.matches(".tds-btn--ghost")).toBe(true);
  await click(buttonNamed("Done"));
  expect(onDone).toHaveBeenCalledTimes(1);

  await renderStatus("failed");
  expect(container.querySelector("a")).toBeNull();
  expect(buttonNamed("Done")?.matches(".tds-btn--primary")).toBe(true);
});
