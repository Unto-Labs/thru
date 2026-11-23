// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WalletSheet } from "./WalletSheet";

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

const renderChooser = (props: Partial<React.ComponentProps<typeof WalletSheet.Deposit>> = {}) =>
  act(async () =>
    root.render(
      <WalletSheet.Deposit
        methods={["crypto", "bank", "card", "faucet"]}
        destination={{ name: "Main", address: "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMD" }}
        {...props}
      />,
    ),
  );
const rowTitles = () =>
  Array.from(container.querySelectorAll(".tds-dep__method-title")).map((title) => title.textContent);
const rowNamed = (title: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>(".tds-dep__method")).find(
    (row) => row.querySelector(".tds-dep__method-title")?.textContent === title,
  );

it("leaves the chooser as it was without onCashOut", async () => {
  await renderChooser();
  const without = container.innerHTML;
  expect(rowTitles()).not.toContain("Cash out");
  await renderChooser({ onCashOut: undefined, cashOutTitle: "Withdraw" });
  expect(container.innerHTML).toBe(without);
});

it("draws Cash out after the deposit methods and before the faucet, with no tag", async () => {
  const onCashOut = vi.fn();
  await renderChooser({ onCashOut });
  expect(rowTitles()).toEqual(["Deposit crypto", "Bank transfer", "Apple Pay or Google Pay", "Cash out", "Test faucet"]);
  const row = rowNamed("Cash out");
  expect(row?.querySelector(".tds-dep__method-sub")?.textContent).toBe("To a US bank");
  expect(row?.querySelector(".tds-dep__method-glyph svg")).not.toBeNull();
  expect(rowNamed("Bank transfer")?.querySelector(".tds-tag")).not.toBeNull();
  expect(row?.querySelector(".tds-tag")).toBeNull();
  expect(container.querySelector(".tds-dep__methods + .tds-dep__lands")).not.toBeNull();
  await act(async () => row?.click());
  expect(onCashOut).toHaveBeenCalledTimes(1);

  await renderChooser({ onCashOut, cashOutTitle: "Withdraw", cashOutDescription: "To your bank" });
  expect(rowNamed("Withdraw")?.querySelector(".tds-dep__method-sub")?.textContent).toBe("To your bank");
});

it("navigates from the accordion too, without a panel of its own", async () => {
  const onCashOut = vi.fn();
  const onCollapse = vi.fn();
  await renderChooser({ onCashOut, open: "bank", onCollapse });
  const row = rowNamed("Cash out");
  expect(row?.parentElement?.classList.contains("tds-dep__methods")).toBe(true);
  expect(row?.hasAttribute("aria-expanded")).toBe(false);
  await act(async () => row?.click());
  expect(onCashOut).toHaveBeenCalledTimes(1);
  expect(onCollapse).not.toHaveBeenCalled();
  expect(container.querySelectorAll(".tds-dep__panel")).toHaveLength(4);
});
