import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DobInput } from "./DobInput";

it("renders a labelled numeric date mask without autofill or a form name", () => {
  const markup = renderToStaticMarkup(<DobInput id="dob" value="01/02/1990" label="Date of birth" onValueChange={() => {}} />);
  expect(markup).toContain('placeholder="MM / DD / YYYY"');
  expect(markup).toContain('inputMode="numeric"');
  expect(markup).toContain('autoComplete="off"');
  expect(markup).toContain('autoCorrect="off"');
  expect(markup).toContain('autoCapitalize="off"');
  expect(markup).toContain('spellCheck="false"');
  expect(markup).toContain('data-1p-ignore="true"');
  expect(markup).toContain('data-lpignore="true"');
  expect(markup).toContain('data-form-type="other"');
  expect(markup).toContain('type="text"');
  expect(markup).not.toContain("maxLength");
  expect(markup).toContain('value="01/02/1990"');
  expect(markup).toContain('for="dob"');
  expect(markup).toMatch(/<input[^>]* id="dob"/);
  expect(markup).not.toMatch(/\sname=/i);
  expect(markup).not.toContain("data-masked");
});

it("disables the date control", () => {
  const markup = renderToStaticMarkup(<DobInput value="" label="Date of birth" disabled onValueChange={() => {}} />);
  expect(markup).toMatch(/<input[^>]*disabled=""/);
});

it("renders validation copy with an invalid control", () => {
  const markup = renderToStaticMarkup(<DobInput value="02/30/1990" label="Date of birth" error="Enter a real date" onValueChange={() => {}} />);
  expect(markup).toContain("Enter a real date");
  expect(markup).toContain('aria-invalid="true"');
});
