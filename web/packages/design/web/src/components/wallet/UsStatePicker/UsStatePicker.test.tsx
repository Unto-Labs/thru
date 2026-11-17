import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { UsStatePicker } from "./UsStatePicker";

it("renders a labelled trigger showing the code without a form name", () => {
  const markup = renderToStaticMarkup(<UsStatePicker id="state" label="State" value="CA" onValueChange={() => {}} />);
  expect(markup).toContain("State");
  expect(markup).toMatch(/<button[^>]*role="combobox"/);
  expect(markup).toContain('id="state"');
  expect(markup).toContain('aria-labelledby=');
  expect(markup).toContain(">CA<");
  expect(markup).not.toMatch(/\sname=/i);
});

it("disables the trigger", () => {
  const markup = renderToStaticMarkup(<UsStatePicker label="State" value={null} disabled onValueChange={() => {}} />);
  expect(markup).toMatch(/<button[^>]*disabled=""/);
});

it("links validation copy to an invalid trigger, including prefilled blocked states", () => {
  const markup = renderToStaticMarkup(<UsStatePicker label="State" value="NY" blocked={{ NY: "Not available in New York" }} error="Not available in New York" onValueChange={() => {}} />);
  expect(markup).toContain("Not available in New York");
  expect(markup).toContain('aria-invalid="true"');
  expect(markup).toContain('aria-describedby=');
  expect(markup).toContain(">NY<");
});
