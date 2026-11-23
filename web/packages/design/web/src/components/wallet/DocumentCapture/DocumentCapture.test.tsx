// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DocumentCapture } from "./DocumentCapture";
import { DOCUMENT_ACCEPT } from "./document";

let container: HTMLDivElement;
let root: Root;
const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let sequence = 0;
  createObjectURL.mockReset().mockImplementation(() => `blob:${++sequence}`);
  revokeObjectURL.mockReset();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    },
  );
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

function ControlledCapture({
  onValueChange = () => {},
}: {
  onValueChange?: (file: File | null) => void;
}) {
  const [value, setValue] = React.useState<File | null>(null);
  return (
    <DocumentCapture
      label="Front"
      value={value}
      onValueChange={(file) => {
        setValue(file);
        onValueChange(file);
      }}
    />
  );
}

function fileInput(camera = false) {
  const input = container.querySelector<HTMLInputElement>(
    camera ? "input[capture]" : "input:not([capture])",
  );
  if (!input) throw new Error("Missing file input");
  return input;
}

async function pick(file: File | null, camera = false) {
  const input = fileInput(camera);
  Object.defineProperty(input, "files", {
    configurable: true,
    value: file ? [file] : [],
  });
  await act(async () =>
    input.dispatchEvent(new Event("change", { bubbles: true })),
  );
  expect(input.value).toBe("");
}

function expectDescription(error?: Element | null) {
  const hint = container.querySelector(".tds-field__desc");
  expect(hint?.id).toBeTruthy();
  for (const button of container.querySelectorAll("button")) {
    const ids = button.getAttribute("aria-describedby")?.split(/\s+/);
    expect(ids).toContain(hint?.id);
    if (error) expect(ids).toContain(error.id);
  }
}

it("renders a labelled empty field with camera and file pickers", async () => {
  await act(async () => root.render(<ControlledCapture />));
  expect(container.textContent).toContain("Front");
  expect(container.textContent).toContain("Add a photo or a file");
  expect(container.textContent).toContain("PDF, PNG or JPG, up to 25 MB");
  expect(
    Array.from(
      container.querySelectorAll(".tds-doc-capture__actions button"),
      (button) => button.textContent,
    ),
  ).toEqual(["Take photo", "Upload file"]);
  const inputs = container.querySelectorAll("input[type=file]");
  expect(inputs).toHaveLength(2);
  for (const input of inputs) {
    expect(input.hasAttribute("name")).toBe(false);
    expect(input.hasAttribute("multiple")).toBe(false);
    expect(input.getAttribute("tabindex")).toBe("-1");
    expect(input.getAttribute("aria-hidden")).toBe("true");
  }
  expect(fileInput(true).getAttribute("capture")).toBe("environment");
  expect(fileInput(true).accept).toBe("image/jpeg,image/png");
  expect(fileInput().accept).toBe(DOCUMENT_ACCEPT);
  const group = container.querySelector('[role="group"]');
  expect(
    document.getElementById(group?.getAttribute("aria-labelledby") ?? "")
      ?.textContent,
  ).toBe("Front");
  expectDescription();

  const cameraClick = vi.spyOn(fileInput(true), "click");
  const uploadClick = vi.spyOn(fileInput(), "click");
  const [camera, upload] = container.querySelectorAll<HTMLButtonElement>(
    ".tds-doc-capture__actions button",
  );
  await act(async () => {
    camera.click();
    upload.click();
  });
  expect(cameraClick).toHaveBeenCalledOnce();
  expect(uploadClick).toHaveBeenCalledOnce();

  const area = container.querySelector<HTMLButtonElement>(
    ".tds-doc-capture__pick",
  );
  expect(area?.textContent).toBe("Add a photo or a file");
  expect(area?.tabIndex).toBe(-1);
  await act(async () => area?.click());
  expect(uploadClick).toHaveBeenCalledTimes(2);
  expect(cameraClick).toHaveBeenCalledOnce();
});

it("previews images, permits picking the same file again, and releases replaced and unmounted URLs", async () => {
  const onValueChange = vi.fn();
  await act(async () =>
    root.render(<ControlledCapture onValueChange={onValueChange} />),
  );
  const first = new File(["png"], "front.png", { type: "image/png" });
  await pick(first);
  expect(onValueChange).toHaveBeenLastCalledWith(first);
  expect(
    container.querySelector('img[alt="Front preview"]')?.getAttribute("src"),
  ).toBe("blob:1");
  expect(
    Array.from(
      container.querySelectorAll(".tds-doc-capture__actions button"),
      (button) => button.textContent,
    ),
  ).toEqual(["Retake", "Replace"]);
  await pick(first);
  expect(onValueChange).toHaveBeenCalledTimes(2);
  expect(revokeObjectURL).not.toHaveBeenCalled();

  await pick(new File(["second"], "new.png", { type: "image/png" }), true);
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:1");
  expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:2");
  await act(async () => root.render(null));
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:2");
});

it("shows a PDF name and decimal size without creating an image URL", async () => {
  await act(async () => root.render(<ControlledCapture />));
  const file = new File(["pdf"], "passport-back.pdf", {
    type: "application/pdf",
  });
  Object.defineProperty(file, "size", { value: 2_400_000 });
  await pick(file);
  expect(container.textContent).toContain("passport-back.pdf");
  expect(container.textContent).toContain("2.4 MB");
  expect(container.querySelector("img")).toBeNull();
  expect(createObjectURL).not.toHaveBeenCalled();
});

it("keeps the accepted file after rejection or cancellation and clears the rejection after a valid pick", async () => {
  const onValueChange = vi.fn();
  await act(async () =>
    root.render(<ControlledCapture onValueChange={onValueChange} />),
  );
  await pick(new File(["png"], "front.png", { type: "image/png" }));
  onValueChange.mockClear();
  await pick(new File(["gif"], "front.gif", { type: "image/gif" }));
  const error = container.querySelector(".tds-field__error");
  expect(error?.textContent).toBe("Use a PDF, PNG or JPG file");
  expect(error?.getAttribute("role")).toBe("alert");
  expect(
    container.querySelector('[role="group"]')?.getAttribute("aria-invalid"),
  ).toBe("true");
  expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:1");
  expect(onValueChange).not.toHaveBeenCalled();
  expectDescription(error);
  await pick(null);
  expect(onValueChange).not.toHaveBeenCalled();
  expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:1");
  await pick(new File(["pdf"], "front.pdf", { type: "application/pdf" }));
  expect(container.querySelector(".tds-field__error")).toBeNull();
  expect(
    container.querySelector('[role="group"]')?.hasAttribute("aria-invalid"),
  ).toBe(false);
  expect(container.querySelector("img")).toBeNull();
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:1");
});

it("rejects an oversized file without allocating a large test buffer", async () => {
  const onValueChange = vi.fn();
  await act(async () =>
    root.render(<ControlledCapture onValueChange={onValueChange} />),
  );
  const file = new File(["png"], "front.png", { type: "image/png" });
  Object.defineProperty(file, "size", { value: 25_000_001 });
  await pick(file);
  expect(container.querySelector(".tds-field__error")?.textContent).toBe(
    "This file is over 25 MB",
  );
  expect(onValueChange).not.toHaveBeenCalled();
  expect(createObjectURL).not.toHaveBeenCalled();
});

it("rejects a wrong-type pick over a caller error, then a caller reset clears it", async () => {
  const onValueChange = vi.fn();
  const png = new File(["png"], "front.png", { type: "image/png" });
  await act(async () =>
    root.render(
      <DocumentCapture
        label="Front"
        value={png}
        error="Upload failed"
        onValueChange={onValueChange}
      />,
    ),
  );
  await pick(new File(["gif"], "front.gif", { type: "image/gif" }));
  expect(container.querySelectorAll(".tds-field__error")).toHaveLength(1);
  expect(container.querySelector(".tds-field__error")?.textContent).toBe(
    "Use a PDF, PNG or JPG file",
  );
  expect(onValueChange).not.toHaveBeenCalled();
  expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:1");

  await act(async () =>
    root.render(
      <DocumentCapture
        label="Front"
        value={null}
        error="Upload failed"
        onValueChange={onValueChange}
      />,
    ),
  );
  expect(container.querySelector(".tds-field__error")?.textContent).toBe(
    "Upload failed",
  );
  expect(container.querySelector("img")).toBeNull();
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:1");

  await act(async () =>
    root.render(
      <DocumentCapture
        label="Front"
        value={null}
        onValueChange={onValueChange}
      />,
    ),
  );
  expect(container.querySelector(".tds-field__error")).toBeNull();
  expect(
    container.querySelector('[role="group"]')?.hasAttribute("aria-invalid"),
  ).toBe(false);
  expect(
    Array.from(
      container.querySelectorAll(".tds-doc-capture__actions button"),
      (button) => button.textContent,
    ),
  ).toEqual(["Take photo", "Upload file"]);
});

it("shows an invalid caller value as a rejection without previewing it", async () => {
  const file = new File(["GIF89a"], "id-front.gif", { type: "image/gif" });
  await act(async () =>
    root.render(
      <DocumentCapture
        label="Front"
        value={file}
        error="Upload failed"
        onValueChange={vi.fn()}
      />,
    ),
  );
  expect(container.querySelectorAll(".tds-field__error")).toHaveLength(1);
  expect(container.querySelector(".tds-field__error")?.textContent).toBe(
    "Use a PDF, PNG or JPG file",
  );
  expect(container.textContent).toContain("Add a photo or a file");
  expect(container.textContent).not.toContain("id-front.gif");
  expect(container.querySelector("img")).toBeNull();
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(
    Array.from(
      container.querySelectorAll(".tds-doc-capture__actions button"),
      (button) => button.textContent,
    ),
  ).toEqual(["Take photo", "Upload file"]);
});

it("links caller errors and disables both buttons and inputs", async () => {
  const onValueChange = vi.fn();
  await act(async () =>
    root.render(
      <DocumentCapture
        id="front"
        className="custom-field"
        label="Front"
        value={null}
        onValueChange={onValueChange}
        error="Upload failed"
        disabled
      />,
    ),
  );
  expect(container.querySelector(".custom-field")).not.toBeNull();
  expect(document.getElementById("front")?.tagName).toBe("BUTTON");
  expect(document.getElementById("front")?.textContent).toBe("Take photo");
  expect(
    container.querySelector('[role="group"]')?.getAttribute("aria-invalid"),
  ).toBe("true");
  const error = container.querySelector(".tds-field__error");
  expect(error?.textContent).toBe("Upload failed");
  expectDescription(error);
  for (const control of container.querySelectorAll<
    HTMLInputElement | HTMLButtonElement
  >("input, button"))
    expect(control.disabled).toBe(true);
  await pick(new File(["png"], "front.png", { type: "image/png" }));
  expect(onValueChange).not.toHaveBeenCalled();

  await act(async () =>
    root.render(
      <DocumentCapture
        id="front"
        label="Front"
        value={null}
        onValueChange={onValueChange}
        error="Upload failed"
      />,
    ),
  );
  document.getElementById("front")?.focus();
  expect(document.activeElement).toBe(document.getElementById("front"));
});
