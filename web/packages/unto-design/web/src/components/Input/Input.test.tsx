import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Input } from "./Input";

it("associates the label with the generated control id when no id is supplied", () => {
  const markup = renderToStaticMarkup(<Input label="Account name" placeholder="Name" />);
  expect(markup).toContain("Account name");
  expect(markup).toContain('placeholder="Name"');
  expect(markup).toContain('class="uds-input uds-input--ui"');
  const inputId = markup.match(/<input[^>]*\sid="([^"]+)"/)?.[1];
  expect(inputId).toBeTruthy();
  expect(markup).toMatch(new RegExp(`<label[^>]*\\sfor="${inputId}"`));
  expect(markup).not.toContain("aria-invalid");
  expect(markup).not.toContain("data-error");
});

it("associates an explicit id with the label during server rendering", () => {
  const markup = renderToStaticMarkup(<Input id="account-name" label="Account name" />);
  expect(markup).toMatch(/<label[^>]*\sfor="account-name"/);
  expect(markup).toMatch(/<input[^>]*\sid="account-name"/);
});

it("links errors and caller descriptions to the control during server rendering", () => {
  const markup = renderToStaticMarkup(
    <Input label="SSN" errorMessage="Enter all 9 digits" aria-describedby="help" />,
  );
  const errorId = markup.match(/<div[^>]*id="([^"]+)"[^>]*class="uds-field__error"/)?.[1];
  expect(errorId).toBeTruthy();
  expect(markup).toContain(`aria-describedby="help ${errorId}"`);
  expect(markup).toContain('aria-invalid="true"');
});
