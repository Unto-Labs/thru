// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WalletSheet } from "./WalletSheet";

const label = "Proof of address";
const documents = [
  { name: label, state: "needed" },
  { name: "Government-issued photo ID", state: "sent" },
] satisfies React.ComponentProps<
  typeof WalletSheet.DepositDocuments
>["documents"];

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

function sendButton() {
  const button = container.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  );
  if (!button) throw new Error("Missing submit button");
  return button;
}

it("lists the requested documents and keeps Send with passkey disabled before selection", async () => {
  const onSubmit = vi.fn();
  await act(async () =>
    root.render(
      <WalletSheet.DepositDocuments
        documents={documents}
        label={label}
        file={null}
        onFileChange={() => {}}
        onSubmit={onSubmit}
      />,
    ),
  );
  expect(container.textContent).toContain("Add a document");
  expect(container.textContent).not.toContain("Brale");
  expect(container.querySelector(".tds-dep__rail-sub")).toBeNull();
  const rows = container.querySelectorAll('ul[role="list"] > li');
  expect(rows).toHaveLength(2);
  expect(rows[0].textContent).toBe("Proof of addressNeeded");
  expect(rows[1].textContent).toBe("Government-issued photo ID");
  expect(
    rows[1].querySelector('[role="img"][aria-label="Sent"]'),
  ).not.toBeNull();
  const fields = container.querySelectorAll('[role="group"]');
  expect(fields).toHaveLength(1);
  const labelId = fields[0].getAttribute("aria-labelledby");
  expect(document.getElementById(labelId ?? "")?.textContent).toBe(label);
  const button = sendButton();
  expect(button.textContent).toBe("Send with passkey");
  expect(button.disabled).toBe(true);
  await act(async () => button.click());
  expect(onSubmit).not.toHaveBeenCalled();
});

it("marks the selected document as Added and enables sending", async () => {
  const onSubmit = vi.fn();
  function Documents() {
    const [file, setFile] = React.useState<File | null>(null);
    return (
      <WalletSheet.DepositDocuments
        documents={[{ name: label, state: file ? "added" : "needed" }]}
        label={label}
        file={file}
        onFileChange={setFile}
        onSubmit={() => onSubmit(file)}
      />
    );
  }
  await act(async () => root.render(<Documents />));
  const file = new File(["%PDF-1.7"], "id.pdf", { type: "application/pdf" });
  const input = container.querySelector('input[type="file"]:not([capture])');
  if (!input) throw new Error("Missing file input");
  Object.defineProperty(input, "files", { value: [file] });
  await act(async () =>
    input.dispatchEvent(new Event("change", { bubbles: true })),
  );
  expect(container.textContent).toContain("id.pdf");
  const row = container.querySelector('ul[role="list"] > li');
  expect(row?.textContent).toBe(label);
  expect(row?.querySelector('[role="img"][aria-label="Added"]')).not.toBeNull();
  expect(sendButton().disabled).toBe(false);
  await act(async () => sendButton().click());
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith(file);
});

it("exposes the upload status", async () => {
  await act(async () =>
    root.render(
      <WalletSheet.DepositDocuments
        title="Add a photo of your ID"
        documents={documents}
        label={label}
        file={null}
        onFileChange={() => {}}
        status="We couldn’t send it. Try again."
        onSubmit={() => {}}
      />,
    ),
  );
  expect(container.textContent).toContain("Add a photo of your ID");
  expect(container.querySelector('[role="status"]')?.textContent).toBe(
    "We couldn’t send it. Try again.",
  );
});

it("locks selection and shows progress while sending", async () => {
  await act(async () =>
    root.render(
      <WalletSheet.DepositDocuments
        documents={documents}
        label={label}
        file={new File(["%PDF-1.7"], "id.pdf", { type: "application/pdf" })}
        onFileChange={() => {}}
        submitting
        onSubmit={() => {}}
      />,
    ),
  );
  for (const control of container.querySelectorAll<
    HTMLInputElement | HTMLButtonElement
  >("input, button")) {
    expect(control.disabled).toBe(true);
  }
  expect(sendButton().getAttribute("aria-busy")).toBe("true");
  expect(
    sendButton().querySelector('[role="status"][aria-label="Loading"]'),
  ).not.toBeNull();
});

it.each([
  { name: "Passport", needsBack: false },
  { name: "National ID", needsBack: true },
])(
  "requires all photos for $name before verifying with a passkey",
  async ({ name, needsBack }) => {
    const onSubmit = vi.fn();
    function Documents() {
      const [file, setFile] = React.useState<File | null>(null);
      const [back, setBack] = React.useState<File | null>(null);
      const hasFiles = !!file && (!needsBack || !!back);
      return (
        <WalletSheet.DepositDocuments
          title="Add a photo of your ID"
          label={needsBack ? "Front of ID" : name}
          documents={[{ name, state: hasFiles ? "added" : "needed" }]}
          file={file}
          onFileChange={setFile}
          back={needsBack ? { file: back, onFileChange: setBack } : undefined}
          submitLabel="Verify with passkey"
          onSubmit={() => onSubmit(file, back)}
        />
      );
    }
    await act(async () => root.render(<Documents />));
    expect(container.textContent).toContain("Add a photo of your ID");
    expect(container.textContent).not.toContain("Brale");
    expect(container.querySelector(".tds-dep__rail-sub")).toBeNull();
    const row = container.querySelector('ul[role="list"] > li');
    expect(row?.textContent).toBe(`${name}Needed`);
    const fieldLabels = Array.from(
      container.querySelectorAll('[role="group"]'),
    ).map(
      (group) =>
        document.getElementById(group.getAttribute("aria-labelledby") ?? "")
          ?.textContent,
    );
    expect(fieldLabels).toEqual(
      needsBack ? ["Front of ID", "Back of ID"] : [name],
    );
    expect(sendButton().textContent).toBe("Verify with passkey");
    expect(sendButton().querySelector(".tds-passkey-icon")).not.toBeNull();
    expect(sendButton().disabled).toBe(true);

    const pickers = container.querySelectorAll(
      'input[type="file"]:not([capture])',
    );
    async function pick(side: number, file: File) {
      const input = pickers[side];
      if (!input) throw new Error("Missing file input");
      Object.defineProperty(input, "files", { value: [file] });
      await act(async () =>
        input.dispatchEvent(new Event("change", { bubbles: true })),
      );
    }
    const front = new File(["%PDF-1.7"], "front.pdf", {
      type: "application/pdf",
    });
    const back = needsBack
      ? new File(["%PDF-1.7"], "back.pdf", { type: "application/pdf" })
      : null;
    await pick(0, front);
    expect(sendButton().disabled).toBe(needsBack);
    if (back) {
      await act(async () => sendButton().click());
      expect(onSubmit).not.toHaveBeenCalled();
      await pick(1, back);
    }
    expect(row?.querySelector('[aria-label="Added"]')).not.toBeNull();
    expect(sendButton().disabled).toBe(false);
    await act(async () => sendButton().click());
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(front, back);
  },
);
