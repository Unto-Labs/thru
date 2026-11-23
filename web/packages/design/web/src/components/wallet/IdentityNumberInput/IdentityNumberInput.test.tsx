// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { IdentityNumberInput } from "./IdentityNumberInput";

const onValueChange = () => {};

describe("IdentityNumberInput", () => {
  it("masks by default, formats the raw value, and disables autofill", () => {
    const markup = renderToStaticMarkup(<IdentityNumberInput kind="ssn" value="123456789" label="SSN" onValueChange={onValueChange} />);
    expect(markup).toContain('data-masked="true"');
    expect(markup).toContain(">Show</button>");
    expect(markup).not.toContain("aria-pressed");
    expect(markup).not.toContain("aria-controls");
    expect(markup).toContain('aria-label="Show number"');
    expect(markup).toContain('value="123-45-6789"');
    expect(markup).toContain('autoComplete="off"');
    expect(markup).toContain('type="text"');
    expect(markup).not.toMatch(/\sname=/i);
    expect(markup).toContain('data-1p-ignore="true"');
    expect(markup).toContain('data-lpignore="true"');
    expect(markup).toContain('data-form-type="other"');
    const inputId = markup.match(/<input[^>]* id="([^"]+)"/)?.[1];
    expect(inputId).toBeTruthy();
    expect(markup).toContain(`for="${inputId}"`);
  });

  it.each([{ revealed: true }, { defaultRevealed: true }])("supports revealed state %o", (props) => {
    const markup = renderToStaticMarkup(<IdentityNumberInput kind="ssn" value="123456789" label="SSN" onValueChange={onValueChange} {...props} />);
    expect(markup).not.toContain("data-masked");
    expect(markup).toContain(">Hide</button>");
    expect(markup).toContain('value="123-45-6789"');
    expect(markup).toContain('aria-label="Hide number"');
  });

  it("gives controlled reveal state precedence", () => {
    const markup = renderToStaticMarkup(<IdentityNumberInput kind="ssn" value="123456789" label="SSN" onValueChange={onValueChange} revealed={false} defaultRevealed />);
    expect(markup).toContain('data-masked="true"');
  });

  it("renders associated labels, errors, and disabled controls", () => {
    const markup = renderToStaticMarkup(<IdentityNumberInput id="ssn" kind="ssn" value="123" label="Social security number" error="Enter all 9 digits" disabled onValueChange={onValueChange} />);
    expect(markup).toContain('for="ssn"');
    expect(markup).toContain("Social security number");
    expect(markup).toContain("Enter all 9 digits");
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toMatch(/<button[^>]*disabled=""/);
    expect(markup).toMatch(/<input[^>]*disabled=""/);
  });

  it("masks a free-form ID by default, limits its length, and preserves its format", () => {
    const markup = renderToStaticMarkup(
      <IdentityNumberInput
        kind="id"
        value="AB-12 / Z"
        label="ID number"
        onValueChange={onValueChange}
      />,
    );
    expect(markup).toContain('value="AB-12 / Z"');
    expect(markup).toContain('inputMode="text"');
    expect(markup).toContain('maxLength="64"');
    expect(markup).toContain('aria-label="Show number"');
  });

  it("emits a free-form edit and lets the user reveal it", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    const onChange = vi.fn();
    try {
      await React.act(async () =>
        root.render(
          <IdentityNumberInput
            kind="id"
            value=""
            label="ID number"
            onValueChange={onChange}
          />,
        ),
      );
      const input = container.querySelector("input");
      const button = container.querySelector("button");
      if (!input || !button)
        throw new Error("Missing ID input or reveal button");
      await React.act(async () => {
        // Bypass React's value tracker to simulate an input event from the browser.
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set?.call(input, "AB-12 / Z");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(onChange).toHaveBeenCalledExactlyOnceWith("AB-12 / Z");
      await React.act(async () => button.click());
      expect(button.getAttribute("aria-label")).toBe("Hide number");
    } finally {
      await React.act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it("refuses a digit typed into the middle of a full bank account number", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    const onChange = vi.fn();
    const full = "12345678901234567";
    try {
      await React.act(async () =>
        root.render(
          <IdentityNumberInput
            kind="bank_account"
            value={full}
            label="Account number"
            defaultRevealed
            onValueChange={onChange}
          />,
        ),
      );
      const input = container.querySelector("input");
      if (!input) throw new Error("Missing account number input");
      await React.act(async () => {
        // Bypass React's value tracker to simulate an input event from the browser.
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set?.call(input, "123456789901234567");
        input.setSelectionRange(9, 9);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(onChange).toHaveBeenCalledExactlyOnceWith(full);
    } finally {
      await React.act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });
});
