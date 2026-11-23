import * as React from "react";
import { readdirSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { IdentityNumberInput } from "./IdentityNumberInput/IdentityNumberInput";
import { IDENTITY_FORMATS } from "./IdentityNumberInput/identity";
import { DobInput } from "./DobInput/DobInput";
import { dobToIso, parseDob, validateDob } from "./DobInput/dob";
import { CashOutBank } from "./WalletSheet/CashOut";
import { DocumentCapture } from "./DocumentCapture/DocumentCapture";
import { checkDocument, formatDocumentSize } from "./DocumentCapture/document";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("does not persist, navigate, or log sensitive values while rendering and formatting", () => {
  const write = vi.fn();
  const storage = { getItem: vi.fn(), setItem: write, removeItem: write, clear: write };
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("sessionStorage", storage);
  vi.stubGlobal("indexedDB", { open: write });
  const document = {};
  Object.defineProperty(document, "cookie", { set: write });
  vi.stubGlobal("document", document);
  vi.stubGlobal("history", { pushState: write, replaceState: write });
  const consoleSpies = Object.getOwnPropertyNames(console)
    .filter((key) => typeof Reflect.get(console, key) === "function")
    .map((key) => [key, vi.fn()] as const);
  vi.stubGlobal("console", Object.fromEntries(consoleSpies));

  renderToStaticMarkup(
    <IdentityNumberInput
      kind="ssn"
      value="987654321"
      label="SSN"
      onValueChange={() => {}}
    />,
  );
  renderToStaticMarkup(
    <IdentityNumberInput
      kind="id"
      value="AB-12 / Z"
      label="ID number"
      onValueChange={() => {}}
    />,
  );
  renderToStaticMarkup(
    <DobInput
      value="01/02/1990"
      label="Date of birth"
      onValueChange={() => {}}
    />,
  );
  renderToStaticMarkup(
    <DobInput
      value="2/29/"
      label="Date of birth"
      error="Enter the month, day and year"
      onValueChange={() => {}}
    />,
  );
  renderToStaticMarkup(
    <CashOutBank
      values={{
        owner: "Test Holder",
        routing_number: "021000021",
        account_number: "000123456789",
        account_number_confirm: "000123456789",
        account_type: "checking",
      }}
      onFieldChange={() => {}}
      onSubmit={() => {}}
    />,
  );
  const file = new File([""], "id.pdf", { type: "application/pdf" });
  renderToStaticMarkup(<DocumentCapture label="Front" value={file} onValueChange={() => {}} />);
  checkDocument(file);
  formatDocumentSize(file.size);
  for (const [fmt, raw] of [
    [IDENTITY_FORMATS.ssn, "987654321"],
    [IDENTITY_FORMATS.bank_account, "000123456789"],
    [IDENTITY_FORMATS.id, "AB-12 / Z"],
  ] as const) {
    fmt.normalize(raw);
    fmt.format(raw);
    fmt.validate(raw);
  }
  for (const dob of ["01/02/1990", "2/29/2024", "2/29/", "02/30/2024"]) {
    parseDob(dob);
    dobToIso(dob);
    validateDob(dob, new Date(2024, 6, 4));
  }

  expect(write).not.toHaveBeenCalled();
  expect(storage.getItem).not.toHaveBeenCalled();
  for (const [, spy] of consoleSpies) expect(spy).not.toHaveBeenCalled();
});

it("keeps persistence and logging APIs out of sensitive input source", () => {
  const forbidden = /localStorage|sessionStorage|indexedDB|document\.cookie|console\.|history\.|location\.|searchParams/;
  for (const file of ["DepositKyc.tsx", "DepositBank.tsx", "CashOut.tsx"]) {
    expect(readFileSync(new URL(`./WalletSheet/${file}`, import.meta.url), "utf8")).not.toMatch(forbidden);
  }
  for (const directory of ["IdentityNumberInput", "DobInput", "DocumentCapture"]) {
    const url = new URL(`./${directory}/`, import.meta.url);
    const files = readdirSync(url).filter((file) => /\.tsx?$/.test(file) && !file.includes(".test."));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(readFileSync(new URL(file, url), "utf8")).not.toMatch(forbidden);
    }
  }
  expect(readFileSync(new URL("./masked-edit.ts", import.meta.url), "utf8")).not.toMatch(forbidden);
});
