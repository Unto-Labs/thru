import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
});
